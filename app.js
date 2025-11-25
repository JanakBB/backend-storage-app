import { config } from "dotenv";
config(); // ← This loads the .env file

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import checkAuth from "./middlewares/authMiddleware.js";
import { connectDB } from "./config/db.js";
import { initializeRedis } from "./config/redis.js";

// Debug: Check if environment variables are loaded
console.log("🔍 Environment check:");
console.log("DB_URL:", process.env.DB_URL ? "✅ Loaded" : "❌ Missing");
console.log("PORT:", process.env.PORT);
console.log("REDIS_HOST:", process.env.REDIS_HOST ? "✅ Loaded" : "❌ Missing");

// Initialize with error handling
async function initializeApp() {
  try {
    console.log("🔄 Starting server initialization...");

    // Verify critical environment variables
    if (!process.env.DB_URL) {
      throw new Error("DB_URL environment variable is not set");
    }

    // 1. Connect to MongoDB first
    console.log("🔄 Connecting to MongoDB...");
    await connectDB();
    console.log("✅ MongoDB connected successfully");

    // 2. Connect to Redis (with error handling)
    console.log("🔄 Connecting to Redis...");
    try {
      await initializeRedis();
      console.log("✅ Redis connected successfully");
    } catch (redisError) {
      console.warn(
        "⚠️ Redis connection failed, but continuing without Redis:",
        redisError.message
      );
    }

    const PORT = process.env.PORT || 4000;
    const app = express();

    // Basic middleware first
    app.use(cookieParser(process.env.SESSION_SECRET));
    app.use(express.json());

    // CORS configuration
    const whitelist = [
      "https://palomacoding.xyz",
      "https://www.palomacoding.xyz",
      "https://api.palomacoding.xyz", // ADD THIS LINE
      "http://localhost:5173", // ADD THIS LINE for development
      "https://accounts.google.com",
    ];

    app.use(
      cors({
        origin: function (origin, callback) {
          if (!origin || whitelist.includes(origin)) {
            callback(null, true);
          } else {
            console.log("CORS blocked for origin:", origin);
            callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      })
    );

    app.options("*", cors());

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({
        status: "OK",
        message: "Backend is running",
        timestamp: new Date().toISOString(),
      });
    });

    app.get("/", (req, res) => {
      res.json({ message: "Hello from StorageApp" });
    });

    // Routes
    app.use("/directory", checkAuth, directoryRoutes);
    app.use("/file", checkAuth, fileRoutes);
    app.use("/", userRoutes);
    app.use("/auth", authRoutes);

    // Error handling
    app.use((err, req, res, next) => {
      console.error("Server Error:", err.message);

      if (err.message === "Not allowed by CORS") {
        return res
          .status(403)
          .json({ error: "CORS policy blocked the request" });
      }

      res.status(err.status || 500).json({ error: "Something went wrong!" });
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server Started on port ${PORT}`);
      console.log(`✅ CORS enabled for:`, whitelist);
      console.log(`🌐 Health check: https://api.palomacoding.xyz/health`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Start the app
initializeApp();
