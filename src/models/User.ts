import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }, // Should be hashed in controller
    avatar: { type: String, default: "anonymous-avatar-icon.svg" },
  },
  { timestamps: true },
);

export default mongoose.model("User", userSchema);
