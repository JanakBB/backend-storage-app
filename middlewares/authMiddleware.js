import { getRedisClient } from "../config/redis.js";

export default async function checkAuth(req, res, next) {
  try {
    const { sid } = req.signedCookies;

    if (!sid) {
      res.clearCookie("sid");
      return res.status(401).json({ error: "Not logged in!" });
    }

    const redisClient = getRedisClient();
    if (!redisClient) {
      console.warn("Redis client not available in auth middleware");
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }

    const session = await redisClient.json.get(`session:${sid}`);

    if (!session) {
      res.clearCookie("sid");
      return res.status(401).json({ error: "Session expired or invalid" });
    }

    req.user = {
      _id: session.userId,
      rootDirId: session.rootDirId,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    // Clear invalid cookie on any error
    res.clearCookie("sid");

    return res.status(500).json({ error: "Authentication error" });
  }
}

export const checkNotRegularUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role !== "User") return next();
  res.status(403).json({ error: "You can not access users" });
};

export const checkIsAdminUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role === "Admin") return next();
  res.status(403).json({ error: "You can not delete users" });
};
