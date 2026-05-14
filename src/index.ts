import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import { getRedisClient, createFreshClient } from "./config/redis";
import chatSocket from "./sockets/chatSocket";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Make io accessible to our router
app.set("io", io);


// Middlewares
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: { policy: "require-corp" },
  }),
);
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    // origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Nexus API is running" });
});

// Routes
import routes from "./routes";
app.use("/api", routes);

import { notFound, errorHandler } from "./middlewares/errorMiddleware";
app.use(notFound);
app.use(errorHandler);

// Initialize Socket.io events
chatSocket(io);

const PORT = process.env.PORT || 5000;

// Start Server
const startServer = async () => {
  try {
    await connectDB();

    // Connect Redis (optional - app works without it)
    const redisClient = await getRedisClient();
    if (redisClient) {
      // Set up Socket.IO Redis adapter for horizontal scaling
      try {
        const { createAdapter } = await import("@socket.io/redis-adapter");
        const pubClient = await createFreshClient();
        const subClient = await createFreshClient();
        
        if (pubClient && subClient) {
          io.adapter(createAdapter(pubClient, subClient));
          console.log("Socket.IO Redis adapter enabled (horizontal scaling ready)");
        } else {
          console.log("Could not create Redis clients for adapter. Running in single-instance mode.");
        }
      } catch (err: any) {
        console.log("Socket.IO Redis adapter not available:", err.message);
        console.log("Running in single-instance mode (this is fine for most use cases)");
      }
    } else {
      console.log("Redis not configured. Running without caching (set REDIS_URL to enable).");
    }

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
