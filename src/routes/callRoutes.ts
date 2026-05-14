import express from "express";
import { getTurnCredentials } from "../controllers/callController";
import { protect } from "../middlewares/authMiddleware";

const router = express.Router();

router.get("/turn-credentials", protect, getTurnCredentials);

export default router;
