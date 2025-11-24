import mongoose, { Types } from "mongoose";
import OTP from "../models/otpModel.js";
import User from "../models/userModel.js"; // ← FIXED: User from userModel
import Directory from "../models/directoryModel.js";
import { verifyIdTokenTakeAnyName } from "../services/googleAuthService.js";
import { sendOtpService } from "../services/sendOtpService.js";
import redisClient from "../config/redis.js";
import { otpSchema } from "../validators/authSchema.js";
import fetch from "node-fetch"; // ← correct

export const sendOtp = async (req, res, next) => {
  const { email } = req.body;
  const resData = await sendOtpService(email);
  res.status(201).json(resData);
};

// मलाई जहाँसमम्म लाग्छ यो verifyOtp यो file मा कुनै काम गरिरहेको छैन । किनकि login with google मा otp को कुनै काम नै छैन । तर यसमा के के मुख्य काम भइरहेको छ त्यो हेर्यौः
// 1. otpSchema (validator)
// 2. OTP.findOne (database)

// 1. otpSchema (validator)
// ------------------------
// 1. otpSchema.safeParse --> success and data is important
// 2. different between console.log(req.body) vs console.log(data) (which one comes from otpSchema)
// 3. data have email and otp.
export const verifyOtp = async (req, res, next) => {
  const { success, data, error } = otpSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: "Invalid OTP" });
  }
  const { email, otp } = data;

  // 2. OTP.findOne (database)
  // -------------------------
  // only return after any error return from the database.
  const otpRecord = await OTP.findOne({ email, otp });

  if (!otpRecord) {
    return res.status(400).json({ error: "Invalid or Expired OTP!" });
  }

  return res.json({ message: "OTP Verified!" });
};

export const loginWithGoogle = async (req, res, next) => {
  const { idToken } = req.body;
  const userData = await verifyIdTokenTakeAnyName(idToken);
  const { name, email, picture } = userData;
  const user = await User.findOne({ email }).select("-__v");
  if (user) {
    if (user.deleted) {
      return res.status(403).json({
        error: "Your account has been deleted. Contact app owner to recover.",
      });
    }

    const allSessions = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${user.id}}`,
      {
        RETURN: [],
      }
    );

    if (allSessions.total >= 2) {
      const delData = await redisClient.del(allSessions.documents[0].id);
    }

    if (!user.picture.includes("googleusercontent.com")) {
      user.picture = picture;
      await user.save();
    }

    const sessionId = crypto.randomUUID();
    const redisKey = `session:${sessionId}`;
    await redisClient.json.set(redisKey, "$", {
      userId: user._id,
      rootDirId: user.rootDirId,
    });

    const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
    await redisClient.expire(redisKey, sessionExpiryTime / 1000);

    res.cookie("sid", sessionId, {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
      maxAge: sessionExpiryTime,
    });

    return res.json({ message: "logged in" });
  }

  // यदि कुनै पनि प्रयोगकर्ता पहिलो पटक गुगलको प्रयोग गरेर login गर्छ भने यता बाट काम सुरु हुन्छ ।
  // 3 वटा मुख्य काम हुन्छन्:
  // 1. mongooseSession with Create Directory and User
  // 2. redis json set with userId and rootDirId
  // 3. cookie set with sessionId

  //1. mongooseSession with Create Directory and User.
  // -------------------------------------------------
  // 1. mongooseSession -> mongoose.startSession()
  // 2. startTransaction -> mongooseSession.startTransaction()
  // 3. {mongooseSession} -> Directory.insertOne({}, {---})
  // 4. {mongooseSession} -> User.insertOne({}, {---})
  // 5. commitTransaction -> mongooseSession.commitTransaction()
  // 6. abortTransaction -> (err) -> mongooseSession.abortTransaction()
  const mongooseSession = await mongoose.startSession();

  try {
    const rootDirId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    mongooseSession.startTransaction();

    await Directory.insertOne(
      {
        _id: rootDirId,
        name: `root-${email}`,
        parentDirId: null,
        userId,
      },
      { mongooseSession }
    );

    await User.insertOne(
      {
        _id: userId,
        name,
        email,
        picture,
        rootDirId,
      },
      { mongooseSession }
    );

    // 2. redis json set with userId and rootDirId
    // 1. redisClient.json.set -> method
    // 2. session:44787fkjd3448444 -> key | key राख्दा session:453456345fdjfkj यो तरिकाले राख्न सकिन्छ ।
    // 3. $ -> path
    // 4. {userId, rootDirId} -> value
    // 5. set expire in second
    const sessionId = crypto.randomUUID();
    const redisKey = `session:${sessionId}`;

    await redisClient.json.set(redisKey, "$", {
      userId: userId,
      rootDirId: rootDirId,
    });
    const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
    await redisClient.expire(redisKey, sessionExpiryTime / 1000);

    // 3. cookie set with sessionId
    // कुकिको काम गर्दा पनि sessionId को प्रयोग गरिएको छ, जुन पछि प्राप्त गर्दा पनि यो sessionId कै आधारमा redis मै search गर्ने हो ।
    res.cookie("sid", sessionId, {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
      maxAge: sessionExpiryTime,
    });

    mongooseSession.commitTransaction();
    res.status(201).json({ message: "account created and logged in" });
  } catch (err) {
    mongooseSession.abortTransaction();
    next(err);
  }
};

// ────────────────────── GITHUB LOGIN START ──────────────────────
export const githubLoginStart = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: "https://api.palomacoding.xyz/auth/github/callback",
    scope: "read:user user:email",
    state: crypto.randomUUID(),
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
};

// ────────────────────── GITHUB CALLBACK ──────────────────────
// Route: GET /auth/github/callback?code=abc123&state=xyz
// GitHub redirects here after user approves login
export const githubCallback = async (req, res) => {
  const { code, state } = req.query;

  // Basic validation
  if (!code) {
    return res.redirect(
      "https://www.palomacoding.xyz/login?error=github_no_code"
    );
  }

  try {
    // 1. Exchange code → access_token
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
    if (tokenData.error) {
      throw new Error(
        tokenData.error_description || "GitHub token exchange failed"
      );
    }
    const { access_token } = tokenData;

    // 2. Get user profile + verified primary email
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

    const primaryEmailObj = emails.find((e) => e.primary && e.verified);
    if (!primaryEmailObj) {
      return res.redirect(
        "https://www.palomacoding.xyz/login?error=no_verified_email"
      );
    }
    const email = primaryEmailObj.email;

    // 3. Find or create user (exactly like your Google flow)
    let user = await User.findOne({
      $or: [{ email }, { githubId: githubUser.id }],
    });

    if (user) {
      // Existing user → update GitHub info
      user.githubId = githubUser.id;
      if (!user.picture?.includes("github")) {
        user.picture = githubUser.avatar_url + "&s=200";
      }
      if (!user.name) user.name = githubUser.name || githubUser.login;
      await user.save();
    } else {
      // New user → create with transaction (same as Google)
      const mongooseSession = await mongoose.startSession();
      try {
        const rootDirId = new Types.ObjectId();
        const userId = new Types.ObjectId();

        mongooseSession.startTransaction();

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

    // 4. Create Redis session + signed cookie (exact copy of Google login)
    const sessionId = crypto.randomUUID();
    const redisKey = `session:${sessionId}`;

    await redisClient.json.set(redisKey, "$", {
      userId: user._id,
      rootDirId: user.rootDirId,
    });

    const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7; // 7 days
    await redisClient.expire(redisKey, sessionExpiryTime / 1000);

    res.cookie("sid", sessionId, {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
      maxAge: sessionExpiryTime,
    });

    // 5. Success → go to dashboard
    res.redirect("https://www.palomacoding.xyz/");
  } catch (err) {
    console.error("GitHub Login Failed:", err.message);
    res.redirect("https://www.palomacoding.xyz/login?error=github_failed");
  }
};
