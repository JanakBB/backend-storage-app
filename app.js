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
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.json());

const whitelist = [
  process.env.CLIENT_URL_1,
  process.env.CLIENT_URL_2,
  "https://accounts.google.com",
  "https://palomacoding.xyz",
  "https://www.palomacoding.xyz",
];

// Enhanced CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, postman) OR origin in whitelist
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

// Handle preflight requests explicitly
app.options("*", cors());

app.get("/", (req, res) => {
  res.json({ message: "Hello from StorageApp" });
});

app.use("/directory", checkAuth, directoryRoutes);
app.use("/file", checkAuth, fileRoutes);
app.use("/", userRoutes);
app.use("/auth", authRoutes);

app.use((err, req, res, next) => {
  console.error("Error:", err.message);

  // Handle CORS errors gracefully
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS policy blocked the request" });
  }

  res.status(err.status || 500).json({ error: "Something went wrong!" });
});

app.listen(PORT, () => {
  console.log(`Server Started on port ${PORT}`);
});
