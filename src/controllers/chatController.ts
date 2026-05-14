import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import Chat from '../models/Chat';
import User from '../models/User';
import Message from '../models/Message';
import { cacheGet, cacheSet, cacheDel } from '../config/redis';

// @desc    Create or fetch 1:1 chat
// @route   POST /api/chats
// @access  Protected
export const accessChat = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body;

  if (!userId) {
    res.status(400);
    throw new Error('userId param not sent with request');
  }

  let isChat = await Chat.find({
    isGroupChat: false,
    $and: [
      { participants: { $elemMatch: { $eq: req.user._id } } },
      { participants: { $elemMatch: { $eq: userId } } },
    ],
  })
    .populate('participants', '-password')
    .populate('latestMessage')
    .populate('pinnedMessages');

  isChat = await User.populate(isChat, {
    path: 'latestMessage.senderId',
    select: 'username avatar email',
  }) as any;

  isChat = await User.populate(isChat, {
    path: 'pinnedMessages.senderId',
    select: 'username avatar email',
  }) as any;

  if (isChat.length > 0) {
    res.send(isChat[0]);
  } else {
    const createdChat = await Chat.create({
      chatName: 'sender',
      isGroupChat: false,
      participants: [req.user._id, userId],
    });

    const fullChat = await Chat.findOne({ _id: createdChat._id }).populate(
      'participants',
      '-password'
    );
    res.status(200).json(fullChat);
  }
});
// Invalidate chat cache for all participants of a chat
const invalidateChatsCache = async (chatId: string) => {
  try {
    const chat = await Chat.findById(chatId).select('participants');
    if (chat) {
      for (const participantId of chat.participants) {
        await cacheDel(`chats:${participantId.toString()}`);
      }
    }
  } catch {
    // Silently fail - cache invalidation is best-effort
  }
};

// @desc    Fetch all chats for a user
// @route   GET /api/chats
// @access  Protected
export const fetchChats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user._id.toString();
  const cacheKey = `chats:${userId}`;

  // Try cache first
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.status(200).json(JSON.parse(cached));
    return;
  }

  let results: any = await Chat.find({ participants: { $elemMatch: { $eq: req.user._id } } })
    .populate('participants', '-password')
    .populate('groupAdmin', '-password')
    .populate('latestMessage')
    .populate('pinnedMessages')
    .sort({ updatedAt: -1 });

  results = await User.populate(results, {
    path: 'latestMessage.senderId',
    select: 'username avatar email',
  });

  results = await User.populate(results, {
    path: 'pinnedMessages.senderId',
    select: 'username avatar email',
  });

  // Cache for 15 seconds
  await cacheSet(cacheKey, JSON.stringify(results), 15);

  res.status(200).send(results);
});

// @desc    Create a group chat
// @route   POST /api/chats/group
// @access  Protected
export const createGroupChat = asyncHandler(async (req: Request, res: Response) => {
  if (!req.body.users || !req.body.name) {
    res.status(400);
    throw new Error("Please fill all the fields");
  }

  let users = JSON.parse(req.body.users);

  if (users.length < 2) {
    res.status(400);
    throw new Error("More than 2 users are required to form a group chat");
  }

  users.push(req.user);

  const groupChat = await Chat.create({
    chatName: req.body.name,
    users: users,
    isGroupChat: true,
    participants: users,
    groupAdmin: req.user,
  });

  // Create system message for group creation
  let systemMsg = await Message.create({
    senderId: req.user._id,
    content: `${req.user.username} created the group "${req.body.name}"`,
    chatId: groupChat._id,
    type: 'system'
  });
  
  systemMsg = await systemMsg.populate("senderId", "username avatar email");
  systemMsg = await systemMsg.populate("chatId");

  await Chat.findByIdAndUpdate(groupChat._id, { latestMessage: systemMsg._id });

  const fullGroupChat = await Chat.findOne({ _id: groupChat._id })
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate({
      path: "latestMessage",
      populate: { path: "senderId", select: "username avatar email" },
    });

  // Invalidate cache for all participants
  await invalidateChatsCache(groupChat._id.toString());

  res.status(200).json({ chat: fullGroupChat, message: systemMsg });
});

// @desc    Rename a group chat
// @route   PUT /api/chats/rename
// @access  Protected
export const renameGroup = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, chatName } = req.body;

  const chat = await Chat.findById(chatId);
  const oldName = chat?.chatName;

  const updatedChatDoc = await Chat.findByIdAndUpdate(
    chatId,
    { chatName: chatName },
    { new: true }
  );

  // Create system message
  let systemMsg = await Message.create({
    senderId: req.user._id,
    content: `${req.user.username} renamed the group from "${oldName}" to "${chatName}"`,
    chatId: chatId,
    type: 'system'
  });

  systemMsg = await systemMsg.populate("senderId", "username avatar email");
  systemMsg = await systemMsg.populate("chatId");

  await Chat.findByIdAndUpdate(chatId, { latestMessage: systemMsg._id });

  const fullChat = await Chat.findOne({ _id: chatId })
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate({
      path: "latestMessage",
      populate: { path: "senderId", select: "username avatar email" },
    });

  await invalidateChatsCache(chatId);

  res.status(200).json({ chat: fullChat, message: systemMsg });
});

// @desc    Add a user to a group chat
// @route   PUT /api/chats/groupadd
// @access  Protected
export const addToGroup = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, userId } = req.body;

  const addedUser = await User.findById(userId);
  
  const updatedChatDoc = await Chat.findByIdAndUpdate(
    chatId,
    { $push: { participants: userId } },
    { new: true }
  );

  // Create system message
  let systemMsg = await Message.create({
    senderId: req.user._id,
    content: `${req.user.username} added ${addedUser?.username} to the group`,
    chatId: chatId,
    type: 'system'
  });

  systemMsg = await systemMsg.populate("senderId", "username avatar email");
  systemMsg = await systemMsg.populate("chatId");

  await Chat.findByIdAndUpdate(chatId, { latestMessage: systemMsg._id });

  const fullChat = await Chat.findOne({ _id: chatId })
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate({
      path: "latestMessage",
      populate: { path: "senderId", select: "username avatar email" },
    });

  await invalidateChatsCache(chatId);
  // Also invalidate the newly added user's cache
  await cacheDel(`chats:${userId}`);

  res.status(200).json({ chat: fullChat, message: systemMsg });
});

// @desc    Remove a user from a group chat
// @route   PUT /api/chats/groupremove
// @access  Protected
export const removeFromGroup = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, userId } = req.body;

  const removedUser = await User.findById(userId);
  const isSelf = req.user._id.toString() === userId.toString();

  const updatedChatDoc = await Chat.findByIdAndUpdate(
    chatId,
    { $pull: { participants: userId } },
    { new: true }
  );

  // Create system message
  let systemMsg = await Message.create({
    senderId: req.user._id,
    content: isSelf ? `${removedUser?.username} left the group` : `${req.user.username} removed ${removedUser?.username} from the group`,
    chatId: chatId,
    type: 'system'
  });

  systemMsg = await systemMsg.populate("senderId", "username avatar email");
  systemMsg = await systemMsg.populate("chatId");

  await Chat.findByIdAndUpdate(chatId, { latestMessage: systemMsg._id });

  const fullChat = await Chat.findOne({ _id: chatId })
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate({
      path: "latestMessage",
      populate: { path: "senderId", select: "username avatar email" },
    });

  await invalidateChatsCache(chatId);
  // Also invalidate the removed user's cache
  await cacheDel(`chats:${userId}`);

  res.status(200).json({ chat: fullChat, message: systemMsg });
});

export const togglePinChat = asyncHandler(async (req: Request, res: Response) => {
  const { chatId } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404);
    throw new Error("Chat not found");
  }

  const isPinned = chat.pinnedBy.includes(req.user._id);

  const updatedChat = await Chat.findByIdAndUpdate(
    chatId,
    isPinned 
      ? { $pull: { pinnedBy: req.user._id } }
      : { $addToSet: { pinnedBy: req.user._id } },
    { new: true }
  )
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate("latestMessage");

  res.status(200).json(updatedChat);
});

export const moveToFolder = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, folderName } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404);
    throw new Error("Chat not found");
  }

  // Remove existing folder entry for this user
  await Chat.findByIdAndUpdate(chatId, {
    $pull: { userFolders: { user: req.user._id } }
  });

  // Add new folder entry
  const updatedChat = await Chat.findByIdAndUpdate(
    chatId,
    { $push: { userFolders: { user: req.user._id, name: folderName } } },
    { new: true }
  )
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate("latestMessage");

  res.status(200).json(updatedChat);
});

export const togglePinMessage = asyncHandler(async (req: Request, res: Response) => {
  const { chatId, messageId } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404);
    throw new Error("Chat not found");
  }

  const isPinned = chat.pinnedMessages.includes(messageId);

  const updatedChat = await Chat.findByIdAndUpdate(
    chatId,
    isPinned 
      ? { $pull: { pinnedMessages: messageId } }
      : { $addToSet: { pinnedMessages: messageId } },
    { new: true }
  )
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate("latestMessage")
    .populate({
      path: "pinnedMessages",
      populate: { path: "senderId", select: "username avatar email" }
    });

  res.status(200).json(updatedChat);
});

export const toggleMuteChat = asyncHandler(async (req: Request, res: Response) => {
  const { chatId } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404);
    throw new Error("Chat not found");
  }

  const isMuted = chat.mutedBy.includes(req.user._id);

  const updatedChat = await Chat.findByIdAndUpdate(
    chatId,
    isMuted 
      ? { $pull: { mutedBy: req.user._id } }
      : { $addToSet: { mutedBy: req.user._id } },
    { new: true }
  )
    .populate("participants", "-password")
    .populate("groupAdmin", "-password")
    .populate("latestMessage")
    .populate({
      path: "pinnedMessages",
      populate: { path: "senderId", select: "username avatar email" }
    });

  res.status(200).json(updatedChat);
});

export const deleteChat = asyncHandler(async (req: Request, res: Response) => {
  const { chatId } = req.params;

  const chat = await Chat.findById(chatId);

  if (!chat) {
    res.status(404);
    throw new Error("Chat not found");
  }

  // Check if group chat and if user is admin
  if (chat.isGroupChat) {
    if (!chat.groupAdmin || chat.groupAdmin.toString() !== req.user._id.toString()) {
      res.status(401);
      throw new Error("Only admin can delete the group chat. Others can only leave.");
    }
  } else {
    // For 1:1 chat, check if user is a participant
    const isParticipant = chat.participants.some(
      (pId: any) => pId.toString() === req.user._id.toString()
    );
    if (!isParticipant) {
      res.status(401);
      throw new Error("Not authorized to delete this chat");
    }
  }
  // Invalidate cache for all participants before deleting
  for (const participantId of chat.participants) {
    await cacheDel(`chats:${participantId.toString()}`);
  }

  // Delete all messages in the chat
  await Message.deleteMany({ chatId: chatId });

  // Delete the chat itself
  await Chat.findByIdAndDelete(chatId);

  res.status(200).json({ message: "Chat deleted successfully" });
});
