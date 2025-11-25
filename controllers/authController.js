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

// Helper function to safely use Redis
const safeRedis = async (operation) => {
  try {
    const redisClient = getRedisClient();
    if (!redisClient) {
      console.warn("Redis not available, skipping Redis operation");
      return null;
    }

    // Check if Redis is connected
    if (redisClient.status !== "ready" && redisClient.status !== "connect") {
      console.warn("Redis not connected, skipping operation");
      return null;
    }

    return await operation(redisClient);
  } catch (error) {
    console.warn("Redis operation failed:", error.message);
    return null;
  }
};

// Helper function to determine domain for redirect
const getRedirectDomain = (req, encodedState = null) => {
  // Try to decode state first
  if (encodedState) {
    try {
      const decodedState = JSON.parse(
        Buffer.from(encodedState, "base64").toString()
      );
      if (decodedState.domain === "www") {
        return "https://www.palomacoding.xyz";
      }
      if (decodedState.domain === "non-www") {
        return "https://palomacoding.xyz";
      }
    } catch (error) {
      console.warn("Failed to parse state:", error.message);
    }
  }

  // Fallback to header detection
  const origin = req.get("Origin");
  const referer = req.get("Referer");

  const detectedDomain = origin || referer;

  if (detectedDomain?.includes("www.palomacoding.xyz")) {
    return "https://www.palomacoding.xyz";
  }

  // Default to non-www
  return "https://palomacoding.xyz";
};

export const sendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const resData = await sendOtpService(email);
    res.status(201).json(resData);
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};

export const verifyOtp = async (req, res, next) => {
  try {
    const { success, data, error } = otpSchema.safeParse(req.body);

    if (!success) {
      return res.status(400).json({
        error: "Invalid OTP format",
        details: error.errors,
      });
    }

    const { email, otp } = data;

    // Find and delete OTP in one operation to prevent replay attacks
    const otpRecord = await OTP.findOneAndDelete({ email, otp });

    if (!otpRecord) {
      return res.status(400).json({ error: "Invalid or Expired OTP!" });
    }

    return res.json({ message: "OTP Verified!" });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ error: "OTP verification failed" });
  }
};

export const loginWithGoogle = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== "string") {
      return res.status(400).json({ error: "Valid ID token is required" });
    }

    const userData = await verifyIdTokenTakeAnyName(idToken);
    const { name, email, picture } = userData;

    if (!email) {
      return res.status(400).json({ error: "Email not found in ID token" });
    }

    let user = await User.findOne({ email }).select("-__v");

    if (user) {
      if (user.deleted) {
        return res.status(403).json({
          error: "Your account has been deleted. Contact app owner to recover.",
        });
      }

      // Safe Redis session cleanup - limit to 3 active sessions
      await safeRedis(async (redisClient) => {
        try {
          const searchResult = await redisClient.ft.search(
            "userIdIdx",
            `@userId:{${user._id.toString()}}`,
            { LIMIT: { from: 0, size: 10 } }
          );

          if (searchResult.total > 3) {
            // Delete oldest sessions, keep newest 3
            const sessionsToDelete = searchResult.documents
              .sort(
                (a, b) =>
                  new Date(a.value.createdAt) - new Date(b.value.createdAt)
              )
              .slice(0, searchResult.total - 3);

            for (const session of sessionsToDelete) {
              await redisClient.del(session.id);
            }
          }
        } catch (redisError) {
          console.warn("Redis session cleanup failed:", redisError.message);
        }
      });

      // Update picture if it's not from Google and new picture is available
      if (picture && !user.picture?.includes("googleusercontent.com")) {
        user.picture = picture;
        await user.save();
      }
    } else {
      // Create new user
      const mongooseSession = await mongoose.startSession();
      mongooseSession.startTransaction();

      try {
        const rootDirId = new Types.ObjectId();
        const userId = new Types.ObjectId();

        // Set transaction timeout
        await mongooseSession.commitTransaction({ maxTimeMS: 10000 });

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
              name: name || email.split("@")[0],
              email,
              picture: picture || null,
              rootDirId,
              maxStorageInBytes: 15 * 1024 ** 3, // 15GB
              role: "User",
            },
          ],
          { session: mongooseSession }
        );

        await mongooseSession.commitTransaction();
        user = await User.findById(userId).select("-__v");
      } catch (error) {
        await mongooseSession.abortTransaction();
        console.error("User creation transaction failed:", error);
        throw new Error("Failed to create user account");
      } finally {
        await mongooseSession.endSession();
      }
    }

    // Create session with safe Redis handling
    const sessionResult = await safeRedis(async (redisClient) => {
      const sessionId = crypto.randomUUID();
      const redisKey = `session:${sessionId}`;

      const sessionData = {
        userId: user._id.toString(),
        rootDirId: user.rootDirId.toString(),
        createdAt: new Date().toISOString(),
        authMethod: "google",
      };

      await redisClient.json.set(redisKey, "$", sessionData);

      const sessionExpirySeconds = 7 * 24 * 60 * 60; // 7 days in seconds
      await redisClient.expire(redisKey, sessionExpirySeconds);

      return {
        sessionId,
        sessionExpiryTime: sessionExpirySeconds * 1000, // Convert to milliseconds for cookie
      };
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
      // Consider if you want to fail login or proceed without session
      return res.status(500).json({ error: "Session service unavailable" });
    }

    return res.json({
      message: user
        ? "Logged in successfully"
        : "Account created and logged in",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        rootDirId: user.rootDirId,
      },
    });
  } catch (error) {
    console.error("Google login error:", error);

    if (error.message.includes("ID token")) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    return res.status(500).json({ error: "Authentication failed" });
  }
};

// GitHub OAuth functions
export const githubLoginStart = (req, res) => {
  try {
    const redirectDomain = getRedirectDomain(req);
    const isWww = redirectDomain.includes("www.palomacoding.xyz");

    const stateData = {
      random: crypto.randomUUID(),
      domain: isWww ? "www" : "non-www",
      timestamp: Date.now(),
    };

    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    const redirectUri =
      process.env.GITHUB_REDIRECT_URI ||
      "https://api.palomacoding.xyz/auth/github/callback";

    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state: state,
    });

    const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    res.redirect(authUrl);
  } catch (error) {
    console.error("GitHub login start error:", error);
    // Fallback to default domain on error
    res.redirect("https://palomacoding.xyz/login?error=github_init_failed");
  }
};

export const githubCallback = async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect("https://palomacoding.xyz/login?error=github_no_code");
  }

  const redirectDomain = getRedirectDomain(req, state);

  try {
    // Exchange code for access token
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

    if (!tokenResponse.ok) {
      throw new Error(
        `GitHub token exchange failed with status: ${tokenResponse.status}`
      );
    }

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(
        tokenData.error_description || "GitHub token exchange failed"
      );
    }

    const { access_token } = tokenData;

    if (!access_token) {
      throw new Error("No access token received from GitHub");
    }

    // Fetch user data
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

    if (!profileRes.ok) {
      throw new Error(`GitHub profile fetch failed: ${profileRes.status}`);
    }

    if (!emailRes.ok) {
      throw new Error(`GitHub emails fetch failed: ${emailRes.status}`);
    }

    const githubUser = await profileRes.json();
    const emails = await emailRes.json();

    // Find primary verified email
    const primaryEmailObj = emails.find(
      (email) => email.primary && email.verified
    );
    if (!primaryEmailObj) {
      return res.redirect(`${redirectDomain}/login?error=no_verified_email`);
    }

    const email = primaryEmailObj.email;

    // Find or create user
    let user = await User.findOne({
      $or: [{ email }, { githubId: githubUser.id.toString() }],
    });

    const mongooseSession = await mongoose.startSession();

    try {
      await mongooseSession.startTransaction();

      if (user) {
        // Update existing user
        user.githubId = githubUser.id.toString();
        if (
          githubUser.avatar_url &&
          !user.picture?.includes("githubusercontent.com")
        ) {
          user.picture = `${githubUser.avatar_url}&s=200`;
        }
        if (githubUser.name && user.name !== githubUser.name) {
          user.name = githubUser.name;
        }
        await user.save({ session: mongooseSession });
      } else {
        // Create new user
        const rootDirId = new Types.ObjectId();
        const userId = new Types.ObjectId();

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
              picture: `${githubUser.avatar_url}&s=200`,
              rootDirId,
              githubId: githubUser.id.toString(),
              maxStorageInBytes: 15 * 1024 ** 3,
              role: "User",
            },
          ],
          { session: mongooseSession }
        );

        user = await User.findById(userId).session(mongooseSession);
      }

      await mongooseSession.commitTransaction();
    } catch (error) {
      await mongooseSession.abortTransaction();
      throw error;
    } finally {
      await mongooseSession.endSession();
    }

    // Create session
    const sessionResult = await safeRedis(async (redisClient) => {
      const sessionId = crypto.randomUUID();
      const redisKey = `session:${sessionId}`;

      const sessionData = {
        userId: user._id.toString(),
        rootDirId: user.rootDirId.toString(),
        createdAt: new Date().toISOString(),
        authMethod: "github",
      };

      await redisClient.json.set(redisKey, "$", sessionData);

      const sessionExpirySeconds = 7 * 24 * 60 * 60; // 7 days
      await redisClient.expire(redisKey, sessionExpirySeconds);

      return {
        sessionId,
        sessionExpiryTime: sessionExpirySeconds * 1000,
      };
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
      return res.redirect(`${redirectDomain}/login?error=session_failed`);
    }

    // Successful login
    res.redirect(`${redirectDomain}/`);
  } catch (error) {
    console.error("GitHub Login Failed:", error.message);
    res.redirect(`${redirectDomain}/login?error=github_auth_failed`);
  }
};

// import mongoose, { Types } from "mongoose";
// import crypto from "crypto";
// import OTP from "../models/otpModel.js";
// import User from "../models/userModel.js";
// import Directory from "../models/directoryModel.js";
// import { verifyIdTokenTakeAnyName } from "../services/googleAuthService.js";
// import { sendOtpService } from "../services/sendOtpService.js";
// import { getRedisClient } from "../config/redis.js";
// import { otpSchema } from "../validators/authSchema.js";
// import fetch from "node-fetch";

// // Don't call getRedisClient() here - it's too early!
// // const redisClient = getRedisClient(); // ← REMOVE THIS LINE

// // Helper function to safely use Redis
// const safeRedis = async (operation) => {
//   const redisClient = getRedisClient();
//   if (!redisClient) {
//     console.warn("Redis not available, skipping Redis operation");
//     return null;
//   }
//   try {
//     return await operation(redisClient);
//   } catch (error) {
//     console.warn("Redis operation failed:", error.message);
//     return null;
//   }
// };

// export const sendOtp = async (req, res, next) => {
//   const { email } = req.body;
//   const resData = await sendOtpService(email);
//   res.status(201).json(resData);
// };

// export const verifyOtp = async (req, res, next) => {
//   const { success, data, error } = otpSchema.safeParse(req.body);

//   if (!success) {
//     return res.status(400).json({ error: "Invalid OTP" });
//   }
//   const { email, otp } = data;

//   const otpRecord = await OTP.findOne({ email, otp });

//   if (!otpRecord) {
//     return res.status(400).json({ error: "Invalid or Expired OTP!" });
//   }

//   return res.json({ message: "OTP Verified!" });
// };

// export const loginWithGoogle = async (req, res, next) => {
//   try {
//     const { idToken } = req.body;

//     if (!idToken) {
//       return res.status(400).json({ error: "ID token is required" });
//     }

//     const userData = await verifyIdTokenTakeAnyName(idToken);
//     const { name, email, picture } = userData;

//     let user = await User.findOne({ email }).select("-__v");

//     if (user) {
//       if (user.deleted) {
//         return res.status(403).json({
//           error: "Your account has been deleted. Contact app owner to recover.",
//         });
//       }

//       // Safe Redis session cleanup
//       await safeRedis(async (redisClient) => {
//         const allSessions = await redisClient.ft.search(
//           "userIdIdx",
//           `@userId:{${user.id}}`,
//           { RETURN: [] }
//         );

//         if (allSessions.total >= 2) {
//           await redisClient.del(allSessions.documents[0].id);
//         }
//       });

//       if (!user.picture?.includes("googleusercontent.com")) {
//         user.picture = picture;
//         await user.save();
//       }
//     } else {
//       // Create new user
//       const mongooseSession = await mongoose.startSession();

//       try {
//         const rootDirId = new Types.ObjectId();
//         const userId = new Types.ObjectId();

//         await mongooseSession.startTransaction();

//         await Directory.create(
//           [
//             {
//               _id: rootDirId,
//               name: `root-${email}`,
//               parentDirId: null,
//               userId,
//               size: 0,
//             },
//           ],
//           { session: mongooseSession }
//         );

//         await User.create(
//           [
//             {
//               _id: userId,
//               name,
//               email,
//               picture,
//               rootDirId,
//               maxStorageInBytes: 15 * 1024 ** 3,
//               role: "User",
//             },
//           ],
//           { session: mongooseSession }
//         );

//         await mongooseSession.commitTransaction();
//         user = await User.findById(userId);
//       } catch (err) {
//         await mongooseSession.abortTransaction();
//         throw err;
//       } finally {
//         mongooseSession.endSession();
//       }
//     }

//     // Create session with safe Redis handling
//     const sessionResult = await safeRedis(async (redisClient) => {
//       const sessionId = crypto.randomUUID();
//       const redisKey = `session:${sessionId}`;

//       await redisClient.json.set(redisKey, "$", {
//         userId: user._id.toString(),
//         rootDirId: user.rootDirId.toString(),
//       });

//       const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7; // 7 days
//       await redisClient.expire(redisKey, sessionExpiryTime / 1000);

//       return { sessionId, sessionExpiryTime };
//     });

//     if (sessionResult) {
//       const { sessionId, sessionExpiryTime } = sessionResult;
//       res.cookie("sid", sessionId, {
//         httpOnly: true,
//         signed: true,
//         sameSite: "none",
//         secure: true,
//         maxAge: sessionExpiryTime,
//       });
//     } else {
//       console.warn("Session not created due to Redis unavailability");
//     }

//     return res.json({
//       message: user ? "logged in" : "account created and logged in",
//       user: {
//         id: user._id,
//         name: user.name,
//         email: user.email,
//         picture: user.picture,
//       },
//     });
//   } catch (error) {
//     console.error("Google login error:", error);
//     return res.status(401).json({ error: "Google authentication failed" });
//   }
// };

// // GitHub OAuth functions
// export const githubLoginStart = (req, res) => {
//   const params = new URLSearchParams({
//     client_id: process.env.GITHUB_CLIENT_ID,
//     redirect_uri: "https://api.palomacoding.xyz/auth/github/callback",
//     scope: "read:user user:email",
//     state: crypto.randomUUID(),
//   });

//   res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
// };

// export const githubCallback = async (req, res) => {
//   const { code, state } = req.query;

//   if (!code) {
//     return res.redirect(
//       "https://www.palomacoding.xyz/login?error=github_no_code"
//     );
//   }

//   try {
//     const tokenResponse = await fetch(
//       "https://github.com/login/oauth/access_token",
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//           "User-Agent": "PalomaCoding",
//         },
//         body: JSON.stringify({
//           client_id: process.env.GITHUB_CLIENT_ID,
//           client_secret: process.env.GITHUB_CLIENT_SECRET,
//           code,
//         }),
//       }
//     );

//     const tokenData = await tokenResponse.json();
//     if (tokenData.error) {
//       throw new Error(
//         tokenData.error_description || "GitHub token exchange failed"
//       );
//     }
//     const { access_token } = tokenData;

//     const [profileRes, emailRes] = await Promise.all([
//       fetch("https://api.github.com/user", {
//         headers: {
//           Authorization: `Bearer ${access_token}`,
//           "User-Agent": "PalomaCoding",
//         },
//       }),
//       fetch("https://api.github.com/user/emails", {
//         headers: {
//           Authorization: `Bearer ${access_token}`,
//           "User-Agent": "PalomaCoding",
//         },
//       }),
//     ]);

//     const githubUser = await profileRes.json();
//     const emails = await emailRes.json();

//     const primaryEmailObj = emails.find((e) => e.primary && e.verified);
//     if (!primaryEmailObj) {
//       return res.redirect(
//         "https://www.palomacoding.xyz/login?error=no_verified_email"
//       );
//     }
//     const email = primaryEmailObj.email;

//     let user = await User.findOne({
//       $or: [{ email }, { githubId: githubUser.id }],
//     });

//     if (user) {
//       user.githubId = githubUser.id;
//       if (!user.picture?.includes("github")) {
//         user.picture = githubUser.avatar_url + "&s=200";
//       }
//       if (!user.name) user.name = githubUser.name || githubUser.login;
//       await user.save();
//     } else {
//       const mongooseSession = await mongoose.startSession();
//       try {
//         const rootDirId = new Types.ObjectId();
//         const userId = new Types.ObjectId();

//         await mongooseSession.startTransaction();

//         await Directory.create(
//           [
//             {
//               _id: rootDirId,
//               name: `root-${email}`,
//               parentDirId: null,
//               userId,
//               size: 0,
//             },
//           ],
//           { session: mongooseSession }
//         );

//         await User.create(
//           [
//             {
//               _id: userId,
//               name: githubUser.name || githubUser.login,
//               email,
//               picture: githubUser.avatar_url + "&s=200",
//               rootDirId,
//               githubId: githubUser.id,
//               maxStorageInBytes: 15 * 1024 ** 3,
//               role: "User",
//             },
//           ],
//           { session: mongooseSession }
//         );

//         await mongooseSession.commitTransaction();
//         user = await User.findById(userId);
//       } catch (err) {
//         await mongooseSession.abortTransaction();
//         throw err;
//       } finally {
//         mongooseSession.endSession();
//       }
//     }

//     // Safe Redis session creation for GitHub
//     const sessionResult = await safeRedis(async (redisClient) => {
//       const sessionId = crypto.randomUUID();
//       const redisKey = `session:${sessionId}`;

//       await redisClient.json.set(redisKey, "$", {
//         userId: user._id.toString(),
//         rootDirId: user.rootDirId.toString(),
//       });

//       const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
//       await redisClient.expire(redisKey, sessionExpiryTime / 1000);

//       return { sessionId, sessionExpiryTime };
//     });

//     if (sessionResult) {
//       const { sessionId, sessionExpiryTime } = sessionResult;
//       res.cookie("sid", sessionId, {
//         httpOnly: true,
//         signed: true,
//         sameSite: "none",
//         secure: true,
//         maxAge: sessionExpiryTime,
//       });
//     } else {
//       console.warn("GitHub: Session not created due to Redis unavailability");
//     }

//     res.redirect("https://palomacoding.xyz/");
//   } catch (err) {
//     console.error("GitHub Login Failed:", err.message);
//     res.redirect("https://palomacoding.xyz/login?error=github_failed");
//   }
// };
