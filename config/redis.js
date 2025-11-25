import { createClient } from "redis";

let redisClient;

// Create Redis client without immediate connection
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

// Initialize Redis connection with retry logic
export const initializeRedis = async () => {
  try {
    redisClient = createRedisClient();

    redisClient.on("error", (err) => {
      console.log("Redis Client Error", err);
    });

    redisClient.on("connect", () => {
      console.log("✅ Redis connected successfully");
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error("❌ Redis connection failed:", error);
    throw error;
  }
};

export const getRedisClient = () => {
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Call initializeRedis() first."
    );
  }
  return redisClient;
};

export default getRedisClient;
