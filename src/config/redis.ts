import Redis from "ioredis";

let redisClient: Redis | null = null;

/**
 * Creates a fresh ioredis client with settings optimized for Upstash/Cloud Redis.
 */
export const createFreshClient = (name: string = "Redis"): Redis | null => {
  const urlString = process.env.REDIS_URL;
  if (!urlString) return null;
  
  try {
    const parsed = new URL(urlString);
    
    // Upstash explicitly requires TLS (rediss://) for their public endpoints.
    // If the URL starts with redis:// (one 's'), we force TLS anyway for Upstash hosts.
    const isUpstash = parsed.hostname.includes("upstash.io");
    const isSecure = parsed.protocol === "rediss:" || isUpstash;
    
    console.log(`[${name}] Host: ${parsed.hostname} | Port: ${parsed.port || 6379} | TLS Required: ${isSecure}`);

    const options: any = {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password,
      username: parsed.username || "default",
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 500, 10000),
      connectTimeout: 10000,
      family: 4, 
      // Force TLS if it's Upstash or rediss:// was provided
      tls: isSecure ? { rejectUnauthorized: false } : undefined,
    };

    const client = new Redis(options);

    client.on("error", (err) => {
      console.error(`[${name}] Error:`, err.message);
    });

    client.on("connect", () => {
      console.log(`[${name}] status: TCP connection established...`);
    });

    client.on("ready", () => {
      console.log(`[${name}] status: Ready (Authentication successful)`);
    });

    client.on("close", () => {
      console.log(`[${name}] status: Connection closed by server`);
    });

    return client;
  } catch (error: any) {
    console.error(`[${name}] config error:`, error.message);
    return null;
  }
};

export const getRedisClient = (): Redis | null => {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;
  redisClient = createFreshClient("Cache Redis");
  return redisClient;
};

// Cache helpers
export const cacheGet = async (key: string): Promise<string | null> => {
  try {
    const client = getRedisClient();
    if (!client || client.status !== "ready") return null;
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
    const client = getRedisClient();
    if (!client || client.status !== "ready") return;
    await client.set(key, value, "EX", ttlSeconds);
  } catch {
    // Silently fail
  }
};

export const cacheDel = async (pattern: string): Promise<void> => {
  try {
    const client = getRedisClient();
    if (!client || client.status !== "ready") return;

    if (!pattern.includes("*")) {
      await client.del(pattern);
      return;
    }

    const stream = client.scanStream({ match: pattern, count: 100 });
    stream.on("data", async (keys) => {
      if (keys.length) {
        const pipeline = client.pipeline();
        keys.forEach((k: string) => pipeline.del(k));
        await pipeline.exec();
      }
    });
  } catch {
    // Silently fail
  }
};
