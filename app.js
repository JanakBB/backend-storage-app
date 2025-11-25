import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import checkAuth from "./middlewares/authMiddleware.js";
import { connectDB } from "./config/db.js";

await connectDB();

const PORT = process.env.PORT || 4000;

const app = express();

// CORS middleware - PLACE THIS AT THE VERY TOP
const whitelist = [
  "https://palomacoding.xyz",
  "https://www.palomacoding.xyz",
  "https://accounts.google.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      if (whitelist.includes(origin)) {
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

// Handle preflight requests for all routes
app.options("*", cors());

app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.json());

// Test route to check if CORS is working
app.get("/health", (req, res) => {
  res.header("Access-Control-Allow-Origin", "https://palomacoding.xyz");
  res.header("Access-Control-Allow-Credentials", "true");
  res.json({
    message: "Server is running",
    timestamp: new Date().toISOString(),
    cors: "enabled",
  });
});

app.get("/", (req, res) => {
  res.json({ message: "Hello from StorageApp" });
});

app.use("/directory", checkAuth, directoryRoutes);
app.use("/file", checkAuth, fileRoutes);
app.use("/", userRoutes);
app.use("/auth", authRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err.message);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: "CORS policy blocked the request",
      allowedOrigins: whitelist,
    });
  }

  res.status(err.status || 500).json({
    error: "Internal server error",
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Server Started on port ${PORT}`);
  console.log(`CORS enabled for:`, whitelist);
});
