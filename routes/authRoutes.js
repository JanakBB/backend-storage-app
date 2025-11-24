import express from "express";
import {
  loginWithGoogle,
  sendOtp,
  verifyOtp,
  githubLoginStart,       // ← NEW
  githubCallback,         // ← NEW
} from "../controllers/authController.js";

const router = express.Router();

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/google", loginWithGoogle);

// ────── GITHUB ROUTES (new) ──────
router.get("/github", githubLoginStart);           // Step 1: redirect to GitHub
router.get("/github/callback", githubCallback);   // Step 2: GitHub sends code here
// ─────────────────────────────────

export default router;
