import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nexus-chat').then(async () => {
  const db = mongoose.connection.db;
  const msgs = await db.collection('messages').find({type: 'ai-image'}).sort({createdAt: -1}).limit(1).toArray();
  if (msgs.length > 0) {
    console.log("Found message:", msgs[0]._id);
    console.log("mediaUrl start:", msgs[0].mediaUrl ? msgs[0].mediaUrl.substring(0, 100) : "null");
    console.log("mediaUrl length:", msgs[0].mediaUrl ? msgs[0].mediaUrl.length : 0);
  } else {
    console.log("No ai-image messages found");
  }
  process.exit(0);
});
