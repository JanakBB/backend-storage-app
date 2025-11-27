import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import Directory from "../models/directoryModel.js";
import { verifyIdTokenTakeAnyName } from "../services/googleAuthService.js";
import { sendOtpService } from "../services/sendOtpService.js";
import { getRedisClient } from "../config/redis.js";
import { otpSchema } from "../validators/authSchema.js";
import fetch from "node-fetch";

// Don't call getRedisClient() here - it's too early!
// const redisClient = getRedisClient(); // ← REMOVE THIS LINE

// Helper function to safely use Redis
const safeRedis = async (operation) => {
  const redisClient = getRedisClient();
  if (!redisClient) {
    console.warn("Redis not available, skipping Redis operation");
    return null;
  }
  try {
    return await operation(redisClient);
  } catch (error) {
    console.warn("Redis operation failed:", error.message);
    return null;
  }
};

export const sendOtp = async (req, res, next) => {
  const { email } = req.body;
  const resData = await sendOtpService(email);
  res.status(201).json(resData);
};

export const verifyOtp = async (req, res, next) => {
  const { success, data, error } = otpSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: "Invalid OTP" });
  }
  const { email, otp } = data;

  const otpRecord = await OTP.findOne({ email, otp });

  if (!otpRecord) {
    return res.status(400).json({ error: "Invalid or Expired OTP!" });
  }

  return res.json({ message: "OTP Verified!" });
};

export const loginWithGoogle = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: "ID token is required" });
    }

    const userData = await verifyIdTokenTakeAnyName(idToken);
    const { name, email, picture } = userData;

    let user = await User.findOne({ email }).select("-__v");

    if (user) {
      if (user.deleted) {
        return res.status(403).json({
          error: "Your account has been deleted. Contact app owner to recover.",
        });
      }

      // Safe Redis session cleanup
      await safeRedis(async (redisClient) => {
        const allSessions = await redisClient.ft.search(
          "userIdIdx",
          `@userId:{${user.id}}`,
          { RETURN: [] }
        );

        if (allSessions.total >= 2) {
          await redisClient.del(allSessions.documents[0].id);
        }
      });

      if (!user.picture?.includes("googleusercontent.com")) {
        user.picture = picture;
        await user.save();
      }
    } else {
      // Create new user
      const mongooseSession = await mongoose.startSession();

      try {
        const rootDirId = new Types.ObjectId();
        const userId = new Types.ObjectId();

        await mongooseSession.startTransaction();

        await Directory.create(
          [
            {
              _id: rootDirId,
              name: `root-${email}`,
              parentDirId: null,
              userId,
              size: 0,
            },
          ],
          { session: mongooseSession }
        );

        await User.create(
          [
            {
              _id: userId,
              name,
              email,
              picture,
              rootDirId,
              maxStorageInBytes: 15 * 1024 ** 3,
              role: "User",
            },
          ],
          { session: mongooseSession }
        );

        await mongooseSession.commitTransaction();
        user = await User.findById(userId);
      } catch (err) {
        await mongooseSession.abortTransaction();
        throw err;
      } finally {
        mongooseSession.endSession();
      }
    }

    // Create session with safe Redis handling
    const sessionResult = await safeRedis(async (redisClient) => {
      const sessionId = crypto.randomUUID();
      const redisKey = `session:${sessionId}`;

      await redisClient.json.set(redisKey, "$", {
        userId: user._id.toString(),
        rootDirId: user.rootDirId.toString(),
      });

      const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7; // 7 days
      await redisClient.expire(redisKey, sessionExpiryTime / 1000);

      return { sessionId, sessionExpiryTime };
    });

    if (sessionResult) {
      const { sessionId, sessionExpiryTime } = sessionResult;
      res.cookie("sid", sessionId, {
        httpOnly: true,
        signed: true,
        sameSite: "none",
        secure: true,
        maxAge: sessionExpiryTime,
      });
    } else {
      console.warn("Session not created due to Redis unavailability");
    }

    return res.json({
      message: user ? "logged in" : "account created and logged in",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
      },
    });
  } catch (error) {
    console.error("Google login error:", error);
    return res.status(401).json({ error: "Google authentication failed" });
  }
};

// GitHub OAuth functions
export const githubLoginStart = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: "https://api.palomacoding.xyz/auth/github/callback",
    scope: "read:user user:email",
    state: crypto.randomUUID(),
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  console.log(`https://github.com/login/oauth/authorize?${params.toString()}`);
};

export const githubCallback = async (req, res) => {
  const { code, state } = req.query;
  console.log({ code, state });

  if (!code) {
    return res.redirect(
      "https://www.palomacoding.xyz/login?error=github_no_code"
    );
  }

  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "PalomaCoding",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      }
    );

    const tokenData = await tokenResponse.json();
    console.log({ tokenData });
    if (tokenData.error) {
      throw new Error(
        tokenData.error_description || "GitHub token exchange failed"
      );
    }
    const { access_token } = tokenData;

    const [profileRes, emailRes] = await Promise.all([
      fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "User-Agent": "PalomaCoding",
        },
      }),
      fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "User-Agent": "PalomaCoding",
        },
      }),
    ]);

    const githubUser = await profileRes.json();
    const emails = await emailRes.json();
    console.log({ githubUser, emails });

    const primaryEmailObj = emails.find((e) => e.primary && e.verified);
    console.log({ primaryEmailObj });
    if (!primaryEmailObj) {
      return res.redirect(
        "https://www.palomacoding.xyz/login?error=no_verified_email"
      );
    }
    const email = primaryEmailObj.email;

    let user = await User.findOne({
      $or: [{ email }, { githubId: githubUser.id }],
    });

    if (user) {
      user.githubId = githubUser.id;
      if (!user.picture?.includes("github")) {
        user.picture = githubUser.avatar_url + "&s=200";
      }
      if (!user.name) user.name = githubUser.name || githubUser.login;
      await user.save();
    } else {
      const mongooseSession = await mongoose.startSession();
      try {
        const rootDirId = new Types.ObjectId();
        const userId = new Types.ObjectId();

        await mongooseSession.startTransaction();

        await Directory.create(
          [
            {
              _id: rootDirId,
              name: `root-${email}`,
              parentDirId: null,
              userId,
              size: 0,
            },
          ],
          { session: mongooseSession }
        );

        await User.create(
          [
            {
              _id: userId,
              name: githubUser.name || githubUser.login,
              email,
              picture: githubUser.avatar_url + "&s=200",
              rootDirId,
              githubId: githubUser.id,
              maxStorageInBytes: 15 * 1024 ** 3,
              role: "User",
            },
          ],
          { session: mongooseSession }
        );

        await mongooseSession.commitTransaction();
        user = await User.findById(userId);
      } catch (err) {
        await mongooseSession.abortTransaction();
        throw err;
      } finally {
        mongooseSession.endSession();
      }
    }

    // Safe Redis session creation for GitHub
    const sessionResult = await safeRedis(async (redisClient) => {
      const sessionId = crypto.randomUUID();
      const redisKey = `session:${sessionId}`;

      await redisClient.json.set(redisKey, "$", {
        userId: user._id.toString(),
        rootDirId: user.rootDirId.toString(),
      });

      const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
      await redisClient.expire(redisKey, sessionExpiryTime / 1000);

      return { sessionId, sessionExpiryTime };
    });

    if (sessionResult) {
      const { sessionId, sessionExpiryTime } = sessionResult;
      res.cookie("sid", sessionId, {
        httpOnly: true,
        signed: true,
        sameSite: "none",
        secure: true,
        maxAge: sessionExpiryTime,
      });
    } else {
      console.warn("GitHub: Session not created due to Redis unavailability");
    }

    res.redirect("https://www.palomacoding.xyz/");
  } catch (err) {
    console.error("GitHub Login Failed:", err.message);
    res.redirect("https://www.palomacoding.xyz/login?error=github_failed");
  }
};
