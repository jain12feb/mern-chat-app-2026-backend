import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import Message from "../models/Message";
import Chat from "../models/Chat";
import OpenAI from "openai";
import { uploadBufferToR2 } from "../config/s3";
import User from "../models/User";

const openrouter = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1", // Using OpenRouter based on the key prefix sk-or
});

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const model = {
  groq: "llama-3.1-8b-instant",
  // openrouter: "google/gemma-4-31b-it:free",
  openrouter: "openrouter/free",
};

// @desc    Summarize last 50 messages in a chat
// @route   POST /api/ai/summarize
// @access  Private
export const summarizeChat = asyncHandler(async (req: any, res: Response) => {
  const { chatId } = req.body;

  if (!chatId) {
    res.status(400);
    throw new Error("Chat ID is required");
  }

  // Verify chat exists and user is participant
  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404);
    throw new Error("Chat not found");
  }

  // Fetch last 50 messages
  const messages = await Message.find({ chatId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("senderId", "username");

  if (messages.length === 0) {
    res.json({ summary: "No messages to summarize yet." });
    return;
  }

  // Format messages for AI
  const messageHistory = messages
    .reverse()
    .map((m: any) => `${m.senderId?.username || "Unknown"}: ${m.content}`)
    .join("\n");

  const systemPrompt = `You are a professional assistant for "Nexus", a modern collaboration platform. Your goal is to provide high-quality "Executive Summaries" of chat conversations.
Format the summary with:
- A brief overview of the main topic.
- Bullet points for key decisions or significant points.
- A section for "Action Items" if any tasks were assigned.

Keep the tone professional, objective, and extremely concise. Use markdown for the bullet points.`;

  const userPrompt = `Conversation History:\n${messageHistory}\n\nProvide the summary now:`;

  try {
    const response = await groq.chat.completions.create({
      model: model.groq,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
    });

    const summary = response.choices[0].message.content;
    res.json({ summary });
  } catch (error: any) {
    console.error("AI Summarization Error:", error);
    res.status(500);
    throw new Error(
      "Failed to generate summary: " + (error.message || "Internal AI Error"),
    );
  }
});

// @desc    Get smart reply suggestions
// @route   POST /api/ai/suggest-replies
// @access  Private
export const getSmartReplies = asyncHandler(async (req: any, res: Response) => {
  const { chatId } = req.body;

  if (!chatId) {
    res.status(400);
    throw new Error("Chat ID is required");
  }

  // Fetch last 5-10 messages for context
  const messages = await Message.find({ chatId })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("senderId", "username");

  if (messages.length === 0) {
    res.json({ suggestions: [] });
    return;
  }

  // Format context
  const context = messages
    .reverse()
    .map((m: any) => `${m.senderId?.username || "Unknown"}: ${m.content}`)
    .join("\n");

  const systemPrompt = `You are a professional communication assistant for Nexus. Your task is to suggest 3 natural-sounding, contextually relevant replies for the current user.
Rules:
1. Vary the tone: provide one proactive/affirmative response, one clarifying/questioning response, and one quick acknowledgement.
2. Keep each reply under 6 words.
3. Match the existing conversation style (formal vs casual).
4. Return ONLY a raw JSON array of strings. Do not include markdown code blocks or explanations.`;

  const userPrompt = `Chat History:\n${context}\n\nSuggest 3 replies:`;

  try {
    const response = await groq.chat.completions.create({
      model: model.groq,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });

    const content = response.choices[0].message.content || "[]";
    // Extract JSON if AI wrapped it in markdown
    const jsonMatch = content.match(/\[.*\]/s);
    const suggestions = JSON.parse(jsonMatch ? jsonMatch[0] : content);

    res.json({ suggestions });
  } catch (error: any) {
    console.error("AI Suggestion Error:", error);
    res.json({ suggestions: [] }); // Fallback to empty instead of error for UX
  }
});

// @desc    Generate an AI image and upload to R2
// @route   POST /api/ai/image
// @access  Private
export const generateAiImage = asyncHandler(async (req: any, res: Response) => {
  const { chatId, prompt, replyToId } = req.body;

  if (!chatId || !prompt) {
    res.status(400);
    throw new Error("Chat ID and prompt are required");
  }

  // Create a dedicated OpenAI instance for images (requires a real OpenAI key, not OpenRouter)
  // const imageAi = new OpenAI({
  //   apiKey: process.env.OPENAI_IMAGE_KEY || process.env.OPENAI_API_KEY,
  // });

  try {
    const response = await openrouter.images.generate({
      model: "openrouter/auto",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });

    const image_base64 = response?.data?.[0]?.b64_json;

    if (!image_base64) {
      throw new Error("No image data returned from AI");
    }

    const buffer = Buffer.from(image_base64, "base64");

    // Upload the buffer directly to Cloudflare R2
    const mediaUrl = await uploadBufferToR2(buffer, "image/png", "png");

    const messagePayload: any = {
      senderId: req.user._id,
      chatId,
      type: "ai-image",
      content: `Prompt: ${prompt}`,
      mediaUrl,
      replyTo: replyToId || undefined,
    };

    const createdMessage = await Message.create(messagePayload);

    // Populate details so the frontend has everything it needs
    let message: any = await Message.findById(createdMessage._id)
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

    const chat = await Chat.findById(chatId);
    if (chat) {
      chat.latestMessage = message._id;
      chat.participants.forEach((pId: any) => {
        if (pId.toString() !== req.user._id.toString()) {
          const uc = chat.unreadCounts.find(
            (u: any) => u.user.toString() === pId.toString(),
          );
          if (uc) uc.count += 1;
          else chat.unreadCounts.push({ user: pId, count: 1 });
        }
      });
      await chat.save();
    }

    res.status(200).json(message);
  } catch (error: any) {
    console.error("AI Image Generation Error:", error);
    res.status(500);
    throw new Error(error.message || "Failed to generate AI image");
  }
});
