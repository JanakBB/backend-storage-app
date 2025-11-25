import Directory from "../models/directoryModel.js";
import User from "../models/userModel.js";
import mongoose, { Types } from "mongoose";
import Session from "../models/sessionModel.js";
import OTP from "../models/otpModel.js";
import { getRedisClient } from "../config/redis.js"; // ← FIXED IMPORT
import { z } from "zod/v4";
import { loginSchema, registerSchema } from "../validators/authSchema.js";
import crypto from "crypto"; // ← ADD MISSING IMPORT

// Helper function for safe Redis operations
const safeRedis = async (operation) => {
  const redisClient = getRedisClient();
  if (!redisClient) {
    console.warn("Redis client not available");
    return null;
  }
  try {
    return await operation(redisClient);
  } catch (error) {
    console.warn("Redis operation failed:", error.message);
    return null;
  }
};

export const register = async (req, res, next) => {
  const { success, data, error } = registerSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: z.flattenError(error).fieldErrors });
  }

  const { name, email, password, otp } = data;
  const otpRecord = await OTP.findOne({ email, otp });

  if (!otpRecord) {
    return res.status(400).json({ error: "Invalid or Expired OTP!" });
  }

  await otpRecord.deleteOne();

  const mongooseSession = await mongoose.startSession();

  try {
    const rootDirId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    await mongooseSession.startTransaction();

    // FIXED: Use create() instead of insertOne()
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

    // FIXED: Use create() instead of insertOne()
    await User.create(
      [
        {
          _id: userId,
          name,
          email,
          password,
          rootDirId,
          maxStorageInBytes: 15 * 1024 ** 3,
          role: "User",
        },
      ],
      { session: mongooseSession }
    );

    await mongooseSession.commitTransaction();

    res.status(201).json({ message: "User Registered" });
  } catch (err) {
    await mongooseSession.abortTransaction();
    console.log(err);
    if (err.code === 121) {
      res
        .status(400)
        .json({ error: "Invalid input, please enter valid details" });
    } else if (err.code === 11000) {
      if (err.keyValue.email) {
        return res.status(409).json({
          error: "This email already exists",
          message:
            "A user with this email address already exists. Please try logging in or use a different email.",
        });
      }
    } else {
      next(err);
    }
  } finally {
    mongooseSession.endSession();
  }
};

export const login = async (req, res, next) => {
  const { success, data } = loginSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: "Invalid Credentials" });
  }

  const { email, password } = data;
  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).json({ error: "Invalid Credentials" });
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    return res.status(404).json({ error: "Invalid Credentials" });
  }

  // Safe Redis session cleanup
  await safeRedis(async (redisClient) => {
    try {
      const allSessions = await redisClient.ft.search(
        "userIdIdx",
        `@userId:{${user.id}}`,
        { RETURN: [] }
      );

      if (allSessions.total >= 2) {
        await redisClient.del(allSessions.documents[0].id);
      }
    } catch (error) {
      console.warn("Session cleanup failed:", error.message);
    }
  });

  // Create new session with safe Redis
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
    res.json({ message: "logged in" });
  } else {
    res.status(500).json({ error: "Failed to create session" });
  }
};

export const getAllUsers = async (req, res) => {
  const allUsers = await User.find({ deleted: false }).lean();
  const allSessions = await Session.find().lean();
  const allSessionsUserId = allSessions.map(({ userId }) => userId.toString());
  const allSessionsUserIdSet = new Set(allSessionsUserId);

  const transformedUsers = allUsers.map(({ _id, name, email }) => ({
    id: _id,
    name,
    email,
    isLoggedIn: allSessionsUserIdSet.has(_id.toString()),
  }));
  res.status(200).json(transformedUsers);
};

export const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.user._id).lean();

  // Check if user exists
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Check if rootDirId exists
  if (!user.rootDirId) {
    return res.status(404).json({ error: "Root directory not found for user" });
  }

  const rootDir = await Directory.findById(user.rootDirId).lean();

  // Check if root directory exists
  if (!rootDir) {
    return res.status(404).json({ error: "Root directory not found" });
  }
  res.status(200).json({
    name: user.name,
    email: user.email,
    picture: user.picture,
    role: user.role,
    maxStorageInBytes: user.maxStorageInBytes,
    usedStorageInBytes: rootDir.size,
  });
};

export const logout = async (req, res) => {
  const sid = req.signedCookies?.sid;

  if (sid) {
    await safeRedis(async (redisClient) => {
      try {
        await redisClient.del(`session:${sid}`);
      } catch (error) {
        console.warn("Failed to delete session from Redis:", error.message);
      }
    });
    res.clearCookie("sid");
  }

  res.status(204).end();
};

export const logoutById = async (req, res, next) => {
  try {
    await Session.deleteMany({ userId: req.params.userId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const logoutAll = async (req, res) => {
  const sid = req.signedCookies?.sid;

  if (!sid) {
    return res.status(204).end();
  }

  await safeRedis(async (redisClient) => {
    try {
      const session = await redisClient.json.get(`session:${sid}`);
      if (session && session.userId) {
        const allSessions = await redisClient.ft.search(
          "userIdIdx",
          `@userId:{${session.userId}}`,
          { RETURN: [] }
        );

        if (allSessions.documents && allSessions.documents.length > 0) {
          const sessionKeys = allSessions.documents.map((doc) => doc.id);
          await Promise.all(sessionKeys.map((key) => redisClient.del(key)));
        }
      }
    } catch (error) {
      console.warn("Logout all failed:", error.message);
    }
  });

  res.clearCookie("sid");
  res.status(204).end();
};

export const deleteUser = async (req, res, next) => {
  const { userId } = req.params;
  if (req.user._id.toString() === userId) {
    return res.status(403).json({ error: "You can not delete yourself." });
  }
  try {
    await Session.deleteMany({ userId });
    await User.findByIdAndUpdate(userId, { deleted: true });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
