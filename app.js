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

import { spawn } from "child_process";
import crypto from "crypto";

// Add this after line 2 (config())
console.log("🔍 CloudFront Config Check:");
console.log(
  "KEY_PAIR_ID:",
  process.env.KEY_PAIR_ID ? "✅ Loaded" : "❌ Missing"
);
console.log(
  "CLOUDFRONT_DISTRIBUTION_DOMAIN:",
  process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN ? "✅ Loaded" : "❌ Missing"
);
if (process.env.CLOUDFRONT_PRIVATE_KEY) {
  console.log("CLOUDFRONT_PRIVATE_KEY: ✅ Loaded");
  // Fix newline issue
  process.env.CLOUDFRONT_PRIVATE_KEY =
    process.env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, "\n");
} else {
  console.log("CLOUDFRONT_PRIVATE_KEY: ❌ Missing");
}

// ADD THESE LINES FOR DEBUGGING:
console.log("🔍 DEBUG - AWS Credentials Check:");
console.log(
  "AWS_ACCESS_KEY_ID:",
  process.env.AWS_ACCESS_KEY_ID ? "✅ Loaded" : "❌ Missing"
);
console.log(
  "AWS_SECRET_ACCESS_KEY:",
  process.env.AWS_SECRET_ACCESS_KEY ? "✅ Loaded" : "❌ Missing"
);
console.log("AWS_REGION:", process.env.AWS_REGION || "❌ Missing");

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

    // CORS Configuration
    const whitelist = [
      "https://palomacoding.xyz",
      "https://www.palomacoding.xyz",
      "https://api.palomacoding.xyz", // API domain
      "http://localhost:5173", // Vite dev server
      "https://accounts.google.com", // Google OAuth
    ];

    app.use(
      cors({
        origin: function (origin, callback) {
          // Allow requests with no origin (like mobile apps or curl requests)
          if (!origin) return callback(null, true);

          if (whitelist.includes(origin)) {
            callback(null, true);
          } else {
            console.log("CORS blocked for origin:", origin);
            callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Requested-With",
          "dirname", // ← ADD THIS LINE
        ],
      })
    );

    // Handle preflight requests for all routes
    app.options("*", cors());
    console.log("✅ CORS enabled for:", whitelist);

    // Replace your current /github-webhook endpoint with this:
    app.post("/github-webhook", (req, res) => {
      // Verifying Github Webhook Signature
      const givenSignature = req.headers["x-hub-signature-256"];
      console.log(givenSignature);
      if (!givenSignature) {
        return res.status(304).json({ error: "Invalid Signature!" });
      }

      const calculatedSignature =
        "sha256=" +
        crypto
          .createHmac("sha256", process.env.GITHUB_SECRET)
          .update(JSON.stringify(req.body))
          .digest("hex");
      console.log(calculatedSignature);
      if (givenSignature !== calculatedSignature) {
        return res.status(304).json({ error: "Invalid Signature!" });
      }

      // Send immediate response to GitHub (within 10 seconds timeout)
      res.json({
        message: "Deployment triggered",
        timestamp: new Date().toISOString(),
      });

      // Run deployment asynchronously

      console.log(
        `[DEPLOY] 🌟 GitHub webhook received for: ${req.body.repository?.name}`
      );

      let repository;
      if (req.body.repository.name === "storage-app-frontend") {
        repository = "frontend";
      } else {
        repository = "backend";
      }

      const bashChildProcess = spawn("bash", [
        `/home/ubuntu/deploy-${repository}.sh`,
      ]);

      let output = "";
      let errorOutput = "";

      bashChildProcess.stdout.on("data", (data) => {
        const text = data.toString().trim();
        output += text + "\n";
        console.log(`[DEPLOY] ${text}`);
      });

      bashChildProcess.stderr.on("data", (data) => {
        const text = data.toString().trim();
        errorOutput += text + "\n";
        console.error(`[DEPLOY ERROR] ${text}`);
      });

      bashChildProcess.on("close", (code) => {
        if (code === 0) {
          console.log(`[DEPLOY] ✅ Deployment completed successfully`);
        } else {
          console.error(`[DEPLOY] ❌ Deployment failed with code: ${code}`);
          console.error(`[DEPLOY] Error output: ${errorOutput}`);
        }
        console.log(
          `[DEPLOY] Total output length: ${output.length} characters`
        );
      });

      bashChildProcess.on("error", (err) => {
        console.error(`[DEPLOY] ❌ Error spawning process: ${err.message}`);
      });
    });

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
      console.log(`✅ CORS enabled for production domains`);
      console.log(`🌐 Health check: https://api.palomacoding.xyz/health`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Start the app
initializeApp();
