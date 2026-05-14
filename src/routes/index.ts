import express from "express";
import authRoutes from "./authRoutes";
import chatRoutes from "./chatRoutes";
import messageRoutes from "./messageRoutes";
import userRoutes from "./userRoutes";
import aiRoutes from "./aiRoutes";
import callRoutes from "./callRoutes";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/chats", chatRoutes);
router.use("/messages", messageRoutes);
router.use("/users", userRoutes);
router.use("/ai", aiRoutes);
router.use("/calls", callRoutes);

export default router;
