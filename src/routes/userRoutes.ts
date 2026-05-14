import express from "express";
import { allUsers, getMe } from "../controllers/userController";
import { protect } from "../middlewares/authMiddleware";

const router = express.Router();

router.route("/").get(protect, allUsers);
router.route("/me").get(protect, getMe);

export default router;
