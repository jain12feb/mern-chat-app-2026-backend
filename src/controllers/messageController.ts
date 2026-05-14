import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import Message from "../models/Message";
import Chat from "../models/Chat";
import User from "../models/User";
import { uploadBase64ToR2, deleteFileFromR2, generatePresignedUrl } from "../config/s3";

const populateMessageDetails = async (messageId: string) => {
  let message: any = await Message.findById(messageId)
    .populate("senderId", "username avatar email")
    .populate("chatId")
    .populate("reactions.user", "username avatar")
    .populate({
      path: "replyTo",
      select: "content type isDeleted senderId createdAt isForwarded",
      populate: {
        path: "senderId",
        select: "username avatar",
      },
    });

  message = await User.populate(message, {
    path: "chatId.participants",
    select: "username avatar email",
  });

  return message;
};

// @desc    Get all messages for a chat (with pagination)
// @route   GET /api/messages/:chatId?before=TIMESTAMP&limit=50
// @access  Protected
export const allMessages = asyncHandler(async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const { before, limit = 50 } = req.query;

  const query: any = { chatId: chatId };
  
  if (before) {
    query.createdAt = { $lt: new Date(before as string) };
  }

  // Fetch messages: newest first, limited count
  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .populate("senderId", "username avatar email")
    .populate("chatId")
    .populate({
      path: "replyTo",
      select: "content type isDeleted senderId createdAt isForwarded",
      populate: {
        path: "senderId",
        select: "username avatar",
      },
    });

  // Reverse them to be in chronological order for the frontend [Oldest -> Newest]
  const chronologicalMessages = [...messages].reverse();
    
  // Reset unread count for this user
  const chat = await Chat.findById(chatId);
  if (chat) {
    const userCount = chat.unreadCounts.find((uc: any) => uc.user.toString() === req.user._id.toString());
    if (userCount) {
      userCount.count = 0;
      await chat.save();
    }
  }

  res.json({
    messages: chronologicalMessages,
    hasMore: messages.length === Number(limit)
  });
});

// @desc    Create new message
// @route   POST /api/messages
// @access  Protected
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { content, chatId, replyToId, isForwarded } = req.body;

  console.log("content", content);
  console.log("chatId", chatId);

  if (!chatId) {
    res.status(400);
    throw new Error("Invalid data passed into request: chatId missing");
  }

  if (replyToId) {
    const replyMessage = await Message.findById(replyToId);
    if (!replyMessage || replyMessage.chatId.toString() !== chatId.toString()) {
      res.status(400);
      throw new Error("Invalid reply message");
    }
  }

  let newMessage = {
    senderId: req.user._id,
    content: content,
    chatId: chatId,
    replyTo: replyToId || undefined,
    isForwarded: Boolean(isForwarded),
  };

  const createdMessage = await Message.create(newMessage);
  const message: any = await populateMessageDetails(createdMessage._id.toString());

  // Increment unread counts for all participants except sender
  const chat = await Chat.findById(chatId);
  if (chat) {
    chat.latestMessage = message._id;
    
    // Initialize or increment unread counts
    chat.participants.forEach((pId: any) => {
      if (pId.toString() !== req.user._id.toString()) {
        const userCount = chat.unreadCounts.find((uc: any) => uc.user.toString() === pId.toString());
        if (userCount) {
          userCount.count += 1;
        } else {
          chat.unreadCounts.push({ user: pId, count: 1 });
        }
      }
    });
    
    await chat.save();
  }

  res.json(message);
});

// @desc    Get a presigned URL for direct R2 upload
// @route   POST /api/messages/upload-url
// @access  Protected
export const getUploadUrl = asyncHandler(async (req: Request, res: Response) => {
  const { fileType, fileName } = req.body;

  if (!fileType) {
    res.status(400);
    throw new Error("fileType is required");
  }

  const ext = fileName ? fileName.split('.').pop() : undefined;
  const result = await generatePresignedUrl(fileType, ext);

  res.json(result);
});

// @desc    Update a message
// @route   PUT /api/messages/:id
// @access  Protected
export const updateMessage = asyncHandler(async (req: Request, res: Response) => {
  const { content } = req.body;
  const messageId = req.params.id;

  const message = await Message.findById(messageId);

  if (!message) {
    res.status(404);
    throw new Error("Message not found");
  }

  if (message.senderId.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error("Not authorized to edit this message");
  }

  // Prevent editing system messages or already deleted messages
  if (message.type === "system" || message.isDeleted) {
    res.status(400);
    throw new Error("Cannot edit this message");
  }

  message.content = content;
  message.isEdited = true;
  await message.save();

  const updatedMessage = await Message.findById(messageId)
    .populate("senderId", "username avatar")
    .populate("chatId")
    .populate({
      path: "replyTo",
      select: "content type isDeleted senderId createdAt isForwarded",
      populate: {
        path: "senderId",
        select: "username avatar",
      },
    });

  res.json(updatedMessage);
});

// @desc    Delete a message
// @route   DELETE /api/messages/:id
// @access  Protected
export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  const { deleteType } = req.body; // 'me' or 'all'
  const messageId = req.params.id;

  const message = await Message.findById(messageId);

  if (!message) {
    res.status(404);
    throw new Error("Message not found");
  }

  // Handle "Delete for me"
  if (deleteType === "me") {
    const userId = req.user._id;
    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
      await message.save();
    }
    res.json(message);
    return;
  }

  // Handle "Delete for everyone"
  if (message.senderId.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error("Not authorized to delete this message for everyone");
  }

  // Prevent deleting system messages
  if (message.type === "system") {
    res.status(400);
    throw new Error("Cannot delete system message");
  }

  // If the message has media, delete it from R2
  if (message.mediaUrl) {
    await deleteFileFromR2(message.mediaUrl);
  }

  message.isDeleted = true;
  message.content = "This message was deleted";
  await message.save();

  const deletedMessage = await Message.findById(messageId)
    .populate("senderId", "username avatar")
    .populate("chatId")
    .populate({
      path: "replyTo",
      select: "content type isDeleted senderId createdAt isForwarded",
      populate: {
        path: "senderId",
        select: "username avatar",
      },
    });

  res.json(deletedMessage);
});

// @desc    React to a message
// @route   POST /api/messages/:id/react
// @access  Protected
export const reactToMessage = asyncHandler(async (req: Request, res: Response) => {
  const { emoji } = req.body;
  const messageId = req.params.id;
  const userId = req.user._id;

  if (!emoji) {
    res.status(400);
    throw new Error("Emoji is required");
  }

  const message = await Message.findById(messageId);

  if (!message) {
    res.status(404);
    throw new Error("Message not found");
  }

  if (message.isDeleted) {
    res.status(400);
    throw new Error("Cannot react to a deleted message");
  }

  const existingReactionIndex = message.reactions.findIndex(
    (r: any) => r.user.toString() === userId.toString()
  );

  if (existingReactionIndex > -1) {
    // User has already reacted
    if (message.reactions[existingReactionIndex].emoji === emoji) {
      // Same emoji, remove reaction (toggle)
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Different emoji, update reaction
      message.reactions[existingReactionIndex].emoji = emoji;
    }
  } else {
    // New reaction
    message.reactions.push({ emoji, user: userId });
  }

  await message.save();

  const updatedMessage = await populateMessageDetails(messageId);

  res.json(updatedMessage);
});

// @desc    Search all messages for a user
// @route   GET /api/messages/search?q=
// @access  Protected
export const searchMessages = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const chatId = req.query.chatId as string;

  console.log(`Search Request - Query: "${query}", ChatID: ${chatId || 'All'}, User: ${req.user._id}`);

  if (!query) {
    res.status(200).json([]);
    return;
  }

  let filter: any = {
    content: { $regex: query, $options: "i" },
    isDeleted: { $ne: true },
    type: 'text'
  };

  if (chatId) {
    filter.chatId = chatId;
  } else {
    // Find all chats the user is part of
    const chats = await Chat.find({ participants: req.user._id });
    const chatIds = chats.map(chat => chat._id);
    console.log(`User is in ${chatIds.length} chats`);
    filter.chatId = { $in: chatIds };
  }

  const messages = await Message.find(filter)
    .populate("senderId", "username avatar")
    .populate("chatId")
    .sort({ createdAt: -1 })
    .limit(50);

  console.log(`Found ${messages.length} matching messages`);
  res.status(200).json(messages);
});

// @desc    Send a media/location/poll/ai-image message
// @route   POST /api/messages/media
// @access  Protected
export const sendMediaMessage = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, type, content, mediaUrl, locationData, pollData, fileData, replyToId } = req.body;

  if (!chatId || !type) {
    res.status(400);
    throw new Error("chatId and type are required");
  }

  const allowedTypes = ['image', 'file', 'location', 'poll', 'ai-image', 'audio'];
  if (!allowedTypes.includes(type)) {
    res.status(400);
    throw new Error("Invalid media type");
  }

  const messagePayload: any = {
    senderId: req.user._id,
    chatId,
    type,
    content: content || '',
    replyTo: replyToId || undefined,
  };

  if (mediaUrl) {
    if (mediaUrl.startsWith("data:")) {
      try {
        const mimeType = fileData?.mimeType || (type === "image" ? "image/png" : "application/octet-stream");
        const ext = fileData?.name ? fileData.name.split('.').pop() : undefined;
        messagePayload.mediaUrl = await uploadBase64ToR2(mediaUrl, mimeType, ext);
      } catch (err) {
        console.error("R2 Upload Error:", err);
        res.status(500);
        throw new Error("Failed to upload media to cloud storage");
      }
    } else {
      messagePayload.mediaUrl = mediaUrl;
    }
  }
  if (locationData) messagePayload.locationData = locationData;
  if (pollData) messagePayload.pollData = pollData;
  if (fileData) messagePayload.fileData = fileData;

  const createdMessage = await Message.create(messagePayload);
  const message: any = await populateMessageDetails(createdMessage._id.toString());

  const chat = await Chat.findById(chatId);
  if (chat) {
    chat.latestMessage = message._id;
    chat.participants.forEach((pId: any) => {
      if (pId.toString() !== req.user._id.toString()) {
        const uc = chat.unreadCounts.find((u: any) => u.user.toString() === pId.toString());
        if (uc) uc.count += 1;
        else chat.unreadCounts.push({ user: pId, count: 1 });
      }
    });
    await chat.save();
  }

  res.json(message);
});

// @desc    Vote on a poll option
// @route   POST /api/messages/:id/poll-vote
// @access  Protected
export const votePoll = asyncHandler(async (req: Request, res: Response) => {
  const { optionIndex } = req.body;
  const messageId = req.params.id;
  const userId = req.user._id;

  const message: any = await Message.findById(messageId);
  if (!message || message.type !== 'poll' || !message.pollData) {
    res.status(404);
    throw new Error("Poll message not found");
  }

  if (message.isDeleted) {
    res.status(400);
    throw new Error("Cannot vote on deleted poll");
  }

  const opts = message.pollData.options;
  if (optionIndex < 0 || optionIndex >= opts.length) {
    res.status(400);
    throw new Error("Invalid option index");
  }

  const userIdStr = userId.toString();

  if (!message.pollData.multipleChoice) {
    // Remove vote from all other options
    opts.forEach((opt: any) => {
      opt.votes = opt.votes.filter((v: any) => v.toString() !== userIdStr);
    });
  }

  const target = opts[optionIndex];
  const alreadyVoted = target.votes.some((v: any) => v.toString() === userIdStr);
  if (alreadyVoted) {
    target.votes = target.votes.filter((v: any) => v.toString() !== userIdStr);
  } else {
    target.votes.push(userId);
  }

  await message.save();
  const updated: any = await populateMessageDetails(messageId);
  res.json(updated);
});
