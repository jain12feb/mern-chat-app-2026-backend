import express from "express";
import { summarizeChat, getSmartReplies, generateAiImage } from "../controllers/aiController";
import { protect } from "../middlewares/authMiddleware";

const router = express.Router();

router.post("/summarize", protect, summarizeChat);
router.post("/suggest-replies", protect, getSmartReplies);
router.post("/image", protect, generateAiImage);

export default router;
