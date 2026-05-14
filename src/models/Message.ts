import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  mediaUrl: { type: String },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'system', 'location', 'poll', 'ai-image', 'audio'],
    default: 'text',
  },
  isForwarded: { type: Boolean, default: false },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Location data
  locationData: {
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String },
  },
  // Poll data
  pollData: {
    question: { type: String },
    options: [{
      text: { type: String },
      votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    }],
    multipleChoice: { type: Boolean, default: false },
  },
  // File/document metadata
  fileData: {
    name: { type: String },
    size: { type: Number },
    mimeType: { type: String },
  },
  aiMetadata: {
    toxicityScore: { type: Number },
    isFlagged: { type: Boolean, default: false },
    summary: { type: String },
  },
  isEdited: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [
    {
      emoji: { type: String, required: true },
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    }
  ],
}, { timestamps: true });

// Performance indexes
messageSchema.index({ chatId: 1, createdAt: -1 }); // pagination: messages by chat sorted newest first
messageSchema.index({ chatId: 1, senderId: 1 });    // mark_as_read: find unread messages by sender in a chat

export default mongoose.model('Message', messageSchema);
