import { createClient } from "redis";

let redisClient = null;
let isInitializing = false;

const createRedisClient = () => {
  return createClient({
    username: "default",
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    },
  });
};

export const initializeRedis = async () => {
  try {
    if (redisClient || isInitializing) return redisClient;

    isInitializing = true;
    redisClient = createRedisClient();

    redisClient.on("error", (err) => {
      console.log("Redis Client Error", err);
    });

    redisClient.on("connect", () => {
      console.log("✅ Redis connected successfully");
    });

    await redisClient.connect();
    isInitializing = false;
    return redisClient;
  } catch (error) {
    isInitializing = false;
    console.error("❌ Redis connection failed:", error);
    throw error;
  }
};

export const getRedisClient = () => {
  if (!redisClient) {
    console.warn("⚠️ Redis client not initialized yet");
    return null;
  }
  return redisClient;
};

// For direct default export with safety
export default getRedisClient;
