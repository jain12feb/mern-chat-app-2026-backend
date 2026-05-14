import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import User from "../models/User";

// @desc    Get or Search all users
// @route   GET /api/users?search=
// @access  Protected
export const allUsers = asyncHandler(async (req: Request, res: Response) => {
  const keyword = req.query.search
    ? {
        $or: [
          { username: { $regex: req.query.search as string, $options: "i" } },
          { email: { $regex: req.query.search as string, $options: "i" } },
        ],
      }
    : {};

  const users = await User.find(keyword)
    .find({ _id: { $ne: req.user._id } })
    .select("-password");
  res.send(users);
});

// @desc    Get current logged in user
// @route   GET /api/users/me
// @access  Private
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user._id).select("-password");
  res.send(user);
});
