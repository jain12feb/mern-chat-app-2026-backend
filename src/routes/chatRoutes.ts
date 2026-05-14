import express from "express";
import {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  togglePinChat,
  moveToFolder,
  togglePinMessage,
  toggleMuteChat,
  deleteChat,
} from "../controllers/chatController";
import { protect } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validateMiddleware";
import {
  createGroupSchema,
  renameGroupSchema,
  groupActionSchema,
} from "../validations/chatValidation";

const router = express.Router();

router.post("/", protect, accessChat);
router.get("/", protect, fetchChats);
router.post("/group", protect, validate(createGroupSchema), createGroupChat);
router.put("/rename", protect, validate(renameGroupSchema), renameGroup);
router.put("/groupadd", protect, validate(groupActionSchema), addToGroup);
router.put(
  "/groupremove",
  protect,
  validate(groupActionSchema),
  removeFromGroup,
);
router.put("/pin", protect, togglePinChat);
router.put("/pin-message", protect, togglePinMessage);
router.put("/mute", protect, toggleMuteChat);
router.put("/folder", protect, moveToFolder);
router.delete("/:chatId", protect, deleteChat);

export default router;
