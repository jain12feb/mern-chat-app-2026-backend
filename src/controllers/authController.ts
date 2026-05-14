import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User";
import { generateTokens } from "../utils/tokens";

export const registerUser = asyncHandler(
  async (req: Request, res: Response) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      res.status(400);
      throw new Error("Please enter all fields");
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      res.status(400);
      throw new Error("User already exists");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
    });

    if (user) {
      const { accessToken, refreshToken } = generateTokens(user.id);

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.status(201).json({
        _id: user.id,
        username: user.username,
        email: user.email,
        accessToken,
      });
    } else {
      res.status(400);
      throw new Error("Invalid user data");
    }
  },
);

export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user: any = await User.findOne({ email });

  if (user && (await bcrypt.compare(password, user.password))) {
    const { accessToken, refreshToken } = generateTokens(user.id);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      _id: user.id,
      username: user.username,
      email: user.email,
      accessToken,
    });
  } else {
    res.status(401);
    throw new Error("Invalid email or password");
  }
});

export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  res.cookie("refreshToken", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: "Logged out successfully" });
});

export const refreshAccessToken = asyncHandler(
  async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(401);
      throw new Error("No refresh token provided");
    }

    const decoded: any = jwt.verify(
      refreshToken,
      process.env.REFRESH_SECRET || "secret-refresh-token-key",
    );
    const user = await User.findById(decoded.id);

    if (!user) {
      res.status(401);
      throw new Error("User not found");
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      user.id,
    );

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ accessToken });
  },
);

export const updateProfile = asyncHandler(async (req: any, res: Response) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.username = req.body.username || user.username;
    user.avatar = req.body.avatar || user.avatar;

    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(req.body.password, salt);
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      username: updatedUser.username,
      email: updatedUser.email,
      avatar: updatedUser.avatar,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

export const checkUsername = asyncHandler(
  async (req: Request, res: Response) => {
    const { username } = req.params;
    const user = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, "i") },
    });
    res.json({ available: !user });
  },
);

export const deleteAccount = asyncHandler(
  async (req: any, res: Response) => {
    const user = await User.findById(req.user._id);

    if (user) {
      await User.deleteOne({ _id: req.user._id });

      // Notify clients about the deleted user
      const io = req.app.get("io");
      if (io) {
        io.emit("user_deleted", req.user._id);
      }

      res.cookie("refreshToken", "", {
        httpOnly: true,
        expires: new Date(0),
      });

      res.json({ message: "Account deleted successfully" });
    } else {
      res.status(404);
      throw new Error("User not found");
    }
  },
);
