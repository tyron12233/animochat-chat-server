import { Redis } from "ioredis";
import type { Message, ChatThemeV2, Participant } from "./types";

// Helper function for consistent key naming
const roomKey = (chatId: string, suffix: string) => `chat:${chatId}:${suffix}`;

export class ChatRoomRepository {
  private redis: Redis;

  constructor(redisClient: Redis) {
    this.redis = redisClient;
  }

  // --- Room Management ---

  async createRoom(chatId: string, name: string, maxParticipants: number) {
    const key = roomKey(chatId, 'info');
    // HSET sets multiple fields in a hash.
    // We stringify the theme object for storage.
    return this.redis.hset(key, {
      name,
      maxParticipants,
      theme: JSON.stringify({}), // Default empty theme
      mode: "light",
    });
  }

  async roomExists(chatId: string): Promise<boolean> {
    const key = roomKey(chatId, 'info');
    return (await this.redis.exists(key)) === 1;
  }
  
  async listPublicRooms(): Promise<{ id: string; name: string; }[]> {
    // This is more complex with Redis. A common pattern is to have a set of all public room IDs.
    const publicRoomIds = await this.redis.smembers('public_rooms');
    const rooms = [];
    for (const chatId of publicRoomIds) {
      const name = await this.redis.hget(roomKey(chatId, 'info'), 'name');
      if (name) {
        rooms.push({ id: chatId, name });
      }
    }
    return rooms;
  }
  
  async makeRoomPublic(chatId: string) {
    return this.redis.sadd('public_rooms', chatId);
  }

  async getRoomInfo(chatId: string) {
    const key = roomKey(chatId, 'info');
    return this.redis.hgetall(key);
  }

  // --- Message Management ---

   async addMessage(chatId: string, message: Message) {
    const key = roomKey(chatId, 'messages');
    await this.redis.lpush(key, JSON.stringify(message));

    // LTRIM keeps the elements from index 0 to 99 (100 total).
    // Since LPUSH adds to the front, this automatically discards the oldest messages.
    await this.redis.ltrim(key, 0, 99);
  }


  async getMessages(chatId: string, start: number, end: number): Promise<Message[]> {
    const key = roomKey(chatId, 'messages');
    const results = await this.redis.lrange(key, start, end);
    // Parse the JSON strings back into Message objects.
    return results.map((msg: string) => JSON.parse(msg)).reverse(); // Reverse to get chronological order
  }

  async getMessageCount(chatId: string): Promise<number> {
    const key = roomKey(chatId, 'messages');
    return this.redis.llen(key);
  }


  // --- Participant & Nickname Management ---

  async addParticipant(chatId: string, userId: string, initialNickname: string) {
    // Add to the set of participants in the room
    await this.redis.sadd(roomKey(chatId, 'participants'), userId);
    // Set their nickname
    await this.redis.hset(roomKey(chatId, 'nicknames'), userId, initialNickname);
  }

  async removeParticipant(chatId: string, userId: string) {
    return this.redis.srem(roomKey(chatId, 'participants'), userId);
  }

  async getParticipantIds(chatId: string): Promise<string[]> {
    return this.redis.smembers(roomKey(chatId, 'participants'));
  }

  async getParticipantCount(chatId: string): Promise<number> {
    return this.redis.scard(roomKey(chatId, 'participants'));
  }
  
  async getNicknames(chatId: string): Promise<Map<string, string>> {
      const nicknamesHash = await this.redis.hgetall(roomKey(chatId, 'nicknames'));
      return new Map(Object.entries(nicknamesHash));
  }

  async getNickname(chatId: string, userId: string): Promise<string | null> {
      return this.redis.hget(roomKey(chatId, 'nicknames'), userId);
  }

  async setNickname(chatId: string, userId: string, newNickname: string) {
      return this.redis.hset(roomKey(chatId, 'nicknames'), userId, newNickname);
  }

  // --- Ban Management ---

  async banUser(chatId: string, userId: string) {
    return this.redis.sadd(roomKey(chatId, 'banned_users'), userId);
  }

  async isUserBanned(chatId: string, userId: string): Promise<boolean> {
    return (await this.redis.sismember(roomKey(chatId, 'banned_users'), userId)) === 1;
  }
  
  async banIp(chatId: string, ip: string) {
      return this.redis.sadd(roomKey(chatId, 'banned_ips'), ip);
  }
  
  async isIpBanned(chatId: string, ip: string): Promise<boolean> {
      return (await this.redis.sismember(roomKey(chatId, 'banned_ips'), ip)) === 1;
  }


  // --- Theme Management ---
  async setTheme(chatId: string, theme: ChatThemeV2, mode: "light" | "dark") {
      const key = roomKey(chatId, 'info');
      await this.redis.hset(key, 'theme', JSON.stringify(theme));
      await this.redis.hset(key, 'mode', mode);
  }
}