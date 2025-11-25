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
  "https://accounts.google.com", // ← Critical for Google login
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin OR origin in whitelist
      if (!origin || origin === "null" || whitelist.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // This sends cookies (sid)
  })
);

// const whitelist = [process.env.CLIENT_URL_1, process.env.CLIENT_URL_2];
// app.use(
//   cors({
//     origin: function (origin, callback) {
//       if (whitelist.indexOf(origin) !== -1 || !origin) {
//         callback(null, true);
//       } else {
//         callback(new Error("Not allowed by CORS"));
//       }
//     },
//     credentials: true,
//   })
// );

app.get("/", (req, res) => {
  res.json({ message: "Hello from StorageApp" });
});

app.use("/directory", checkAuth, directoryRoutes);
app.use("/file", checkAuth, fileRoutes);
app.use("/", userRoutes);
app.use("/auth", authRoutes);

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: "Something went wrong!" });
  // res.json(err);
});

app.listen(PORT, () => {
  console.log(`Server Started`);
});
