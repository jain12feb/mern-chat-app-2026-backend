import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;
let isConnected = false;

export const getRedisClient = async (): Promise<RedisClientType | null> => {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (redisClient && isConnected) {
    return redisClient;
  }

  try {
    const isSecure = process.env.REDIS_URL.startsWith("rediss://");
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        tls: isSecure,
        rejectUnauthorized: false,
      },
      pingInterval: 5000, // Frequent pings to keep the socket alive
    });

    redisClient.on("error", (err) => {
      console.error("Redis Client Error:", err.message);
      isConnected = false;
    });

    redisClient.on("connect", () => {
      console.log("Redis connected");
      isConnected = true;
    });

    redisClient.on("reconnecting", () => {
      console.log("Redis reconnecting...");
    });

    await redisClient.connect();
    return redisClient;
  } catch (error: any) {
    console.error("Redis connection failed:", error.message);
    console.log("App will continue without Redis caching.");
    redisClient = null;
    isConnected = false;
    return null;
  }
};

export const createFreshClient = async (): Promise<RedisClientType | null> => {
  if (!process.env.REDIS_URL) return null;
  const isSecure = process.env.REDIS_URL.startsWith("rediss://");
  try {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        tls: isSecure,
        rejectUnauthorized: false,
      },
      pingInterval: 5000,
    });
    client.on("error", (err) => console.error("Fresh Redis Client Error:", err.message));
    await client.connect();
    return client as RedisClientType;
  } catch (error: any) {
    console.error("Failed to create fresh Redis client:", error.message);
    return null;
  }
};

// Cache helpers with graceful fallback
export const cacheGet = async (key: string): Promise<string | null> => {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    return await client.get(key);
  } catch {
    return null;
  }
};

export const cacheSet = async (
  key: string,
  value: string,
  ttlSeconds: number = 30,
): Promise<void> => {
  try {
    const client = await getRedisClient();
    if (!client) return;
    await client.set(key, value, { EX: ttlSeconds });
  } catch {
    // Silently fail - caching is an optimization, not a requirement
  }
};

export const cacheDel = async (pattern: string): Promise<void> => {
  try {
    const client = await getRedisClient();
    if (!client) return;

    // If it's a specific key, delete it directly
    if (!pattern.includes("*")) {
      await client.del(pattern);
      return;
    }

    // For patterns, use SCAN to find matching keys
    let cursor = 0;
    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await client.del(result.keys);
      }
    } while (cursor !== 0);
  } catch {
    // Silently fail
  }
};
