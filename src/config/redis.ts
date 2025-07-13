import { Redis } from "ioredis";
import type { IChatRoomRepository } from "../repository/chat-room-repository";
import { SupabaseChatRoomRepository } from "../repository/supabase-impl";
import { createClient } from "@supabase/supabase-js";
import { RedisChatRoomRepository } from "../repository/redis-impl";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error("REDIS_URL is not defined in the environment variables");
}

const redisClient = new Redis(REDIS_URL);
let repository: IChatRoomRepository | null = null;

redisClient.on("error", (err) => {
  console.error("Redis ClientError", err);
});

async function initializeRedis() {
  if (redisClient.status !== "ready" && redisClient.status !== "connecting" && redisClient.status !== "reconnecting") {
    await redisClient.connect();
  }
}


async function initialize() {
    await initializeRedis();

    repository = createChatRoomRepository('supabase');
}

function getChatRoomRepository(): IChatRoomRepository {
    if (!repository) {
        throw new Error("ChatRoomRepository is not initialized. Call initialize() first.");
    }
    return repository;
}

type BackendType = 'redis' | 'supabase';

export function createChatRoomRepository(
  backend: BackendType
): IChatRoomRepository {
  const backendType = backend || 'redis'; // Default to redis

  console.log(`Initializing chat repository with backend: ${backendType}`);

  if (backendType === 'supabase') {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in environment variables.");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    return new SupabaseChatRoomRepository(supabaseClient);
  }

  if (backendType === 'redis') {
    // Assumes your Redis client is configured elsewhere and passed in.
    // For a standalone setup, you might initialize it here.
    const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    return new RedisChatRoomRepository(redisClient);
  }

  throw new Error(`Unsupported backend type: ${backendType}`);
}

export { redisClient, initialize, getChatRoomRepository };
