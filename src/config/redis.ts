import { Redis } from "ioredis";
import { ChatRoomRepository } from "../chat-room-repository";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error("REDIS_URL is not defined in the environment variables");
}

const redisClient = new Redis(REDIS_URL);
let repository: ChatRoomRepository | null = null;

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

    repository = new ChatRoomRepository(redisClient);
}

function getChatRoomRepository(): ChatRoomRepository {
    if (!repository) {
        throw new Error("ChatRoomRepository is not initialized. Call initialize() first.");
    }
    return repository;
}

export { redisClient, initialize, getChatRoomRepository };
