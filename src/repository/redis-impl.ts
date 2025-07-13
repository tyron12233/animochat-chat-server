import type Redis from "ioredis";
import type { ChatRoomInfo, ChatThemeV2, Message, PublicRoomInfo, Reaction } from "../types";
import type { IChatRoomRepository } from "./chat-room-repository";

const redisRoomKey = (chatId: string, suffix: string) => `chat:${chatId}:${suffix}`;

export class RedisChatRoomRepository implements IChatRoomRepository {
  private redis: Redis;

  constructor(redisClient: Redis) {
    this.redis = redisClient;
  }

  // --- Room Management ---
  async markClosed(chatId: string) {
    const key = redisRoomKey(chatId, "info");
    return this.redis.hset(key, "closed", "true");
  }

  async isRoomClosed(chatId: string): Promise<boolean> {
    const key = redisRoomKey(chatId, "info");
    const closed = await this.redis.hget(key, "closed");
    return closed === "true";
  }

  async createRoom(chatId: string, name: string, maxParticipants: number) {
    const key = redisRoomKey(chatId, "info");
    return this.redis.hset(key, {
      name,
      maxParticipants,
      theme: JSON.stringify(null),
      mode: "light",
      closed: "false",
    });
  }

  async deleteRoom(chatId: string) {
    const keysToDelete = [
      redisRoomKey(chatId, "info"),
      redisRoomKey(chatId, "messages"),
      redisRoomKey(chatId, "participants"),
      redisRoomKey(chatId, "nicknames"),
      redisRoomKey(chatId, "banned_users"),
      redisRoomKey(chatId, "banned_ips"),
      redisRoomKey(chatId, "ghosts"),
    ];
    const pipeline = this.redis.pipeline();
    pipeline.del(...keysToDelete);
    pipeline.srem("public_rooms", chatId);
    await pipeline.exec();
    console.log(`[${chatId}] DELETED room from Redis.`);
  }

  async roomExists(chatId: string): Promise<boolean> {
    const key = redisRoomKey(chatId, "info");
    return (await this.redis.exists(key)) === 1;
  }

  async listPublicRooms(): Promise<PublicRoomInfo[]> {
    const publicRoomIds = await this.redis.smembers("public_rooms");
    if (publicRoomIds.length === 0) return [];

    const rooms = await Promise.all(
      publicRoomIds.map(async (chatId) => {
        const [name, maxParticipantsStr] = await this.redis.hmget(
          redisRoomKey(chatId, "info"), "name", "maxParticipants"
        );
        if (!name) return null;
        return {
          id: chatId,
          name: name,
          max_participants: parseInt(maxParticipantsStr ?? "10", 10) || 2,
        };
      })
    );
    return rooms.filter((room): room is PublicRoomInfo => room !== null);
  }

  async makeRoomPublic(chatId: string) {
    return this.redis.sadd("public_rooms", chatId);
  }

   async getRoomInfo(chatId: string) {
    const key = redisRoomKey(chatId, "info");
    return this.redis.hgetall(key);
  }

  async getAllRoomIds(): Promise<string[]> {
    const roomIds: string[] = [];
    let cursor = "0";
    do {
      const [newCursor, keys] = await this.redis.scan(cursor, "MATCH", "chat:*:info", "COUNT", 100);
      for (const key of keys) {
        const chatId = key.split(":")[1];
        if (chatId) roomIds.push(chatId);
      }
      cursor = newCursor;
    } while (cursor !== "0");
    return roomIds;
  }

  // --- Message Management ---
    /**
     * Add, update, or remove a reaction on a message.
     * @param chatId   the room ID
     * @param reaction the reaction payload
     * @returns        true if message found & updated, false otherwise
     */
    async updateReaction(chatId: string, reaction: Reaction): Promise<boolean> {
      const key = redisRoomKey(chatId, "messages");
      // Fetch the entire list (0 = newest)
      const raw = await this.redis.lrange(key, 0, -1);
  
      for (let idx = 0; idx < raw.length; idx++) {
        if (!raw[idx]) continue; // Skip empty entries
        const msg: Message & { reactions?: Reaction[] } = JSON.parse(raw[idx]!);
        if (msg.id !== reaction.message_id) continue;
  
        // Initialize reactions array
        const reps = msg.reactions ?? [];
        // Find if this user already reacted
        const existing = reps.findIndex((r) => r.user_id === reaction.user_id);
  
        let updated: Reaction[];
        if (existing > -1) {
          if (reaction.emoji) {
            // update existing
            updated = [...reps];
            updated[existing] = reaction;
          } else {
            // remove reaction
            updated = reps.filter((_, i) => i !== existing);
          }
        } else if (reaction.emoji) {
          // add new
          updated = [...reps, reaction];
        } else {
          // nothing to do
          updated = reps;
        }
  
        msg.reactions = updated;
        // persist back into the list
        await this.redis.lset(key, idx, JSON.stringify(msg));
        return true;
      }
  
      return false;
    }

  async markMessageAsDeleted(chatId: string, messageId: string): Promise<boolean> {
    const key = redisRoomKey(chatId, "messages");
    const raw = await this.redis.lrange(key, 0, -1);
    for (let idx = 0; idx < raw.length; idx++) {
      if (!raw[idx]) continue;
      const msg: Message = JSON.parse(raw[idx]!);
      if (msg.id === messageId) {
        msg.type = "deleted";
        await this.redis.lset(key, idx, JSON.stringify(msg));
        return true;
      }
    }
    return false;
  }

  async editMessage(chatId: string, messageId: string, newContent: string): Promise<boolean> {
    const key = redisRoomKey(chatId, "messages");
    const raw = await this.redis.lrange(key, 0, -1);
    for (let idx = 0; idx < raw.length; idx++) {
      if (!raw[idx]) continue;
      const msg: Message = JSON.parse(raw[idx]!);
      if (msg.id === messageId) {
        msg.content = newContent;
        msg.edited = true;
        await this.redis.lset(key, idx, JSON.stringify(msg));
        return true;
      }
    }
    return false;
  }

  async addMessage(chatId: string, message: Message) {
    const key = redisRoomKey(chatId, "messages");
    await this.redis.lpush(key, JSON.stringify(message));
    await this.redis.ltrim(key, 0, 99);
  }

  async getMessages(chatId: string, start: number, end: number): Promise<Message[]> {
    const key = redisRoomKey(chatId, "messages");
    const results = await this.redis.lrange(key, start, end);
    return results.map((msg: string) => JSON.parse(msg)).reverse();
  }

  async getMessageCount(chatId: string): Promise<number> {
    const key = redisRoomKey(chatId, "messages");
    return this.redis.llen(key);
  }

  // --- Participant & Nickname Management ---
  async containsParticipant(chatId: string, userId: string): Promise<boolean> {
    return (await this.redis.sismember(redisRoomKey(chatId, "participants"), userId)) === 1;
  }

  async addParticipant(chatId: string, userId: string, initialNickname: string) {
    await this.redis.sadd(redisRoomKey(chatId, "participants"), userId);
    await this.redis.hset(redisRoomKey(chatId, "nicknames"), userId, initialNickname);
  }

  async removeParticipant(chatId: string, userId: string) {
    await this.redis.srem(redisRoomKey(chatId, "participants"), userId);
    await this.redis.hdel(redisRoomKey(chatId, "nicknames"), userId);
    await this.redis.srem(redisRoomKey(chatId, "ghosts"), userId);
  }

  async getParticipantIds(chatId: string): Promise<string[]> {
    return this.redis.smembers(redisRoomKey(chatId, "participants"));
  }

  async getParticipantCount(chatId: string): Promise<number> {
    return this.redis.scard(redisRoomKey(chatId, "participants"));
  }

  async getNicknames(chatId: string): Promise<Map<string, string>> {
    const nicknamesHash = await this.redis.hgetall(redisRoomKey(chatId, "nicknames"));
    return new Map(Object.entries(nicknamesHash));
  }

  async getNickname(chatId: string, userId: string): Promise<string | null> {
    return this.redis.hget(redisRoomKey(chatId, "nicknames"), userId);
  }

  async setNickname(chatId: string, userId: string, newNickname: string) {
    return this.redis.hset(redisRoomKey(chatId, "nicknames"), userId, newNickname);
  }

  // --- Ghost Mode ---
  async setGhostMode(chatId: string, userId: string, isGhost: boolean) {
    const key = redisRoomKey(chatId, "ghosts");
    return isGhost ? this.redis.sadd(key, userId) : this.redis.srem(key, userId);
  }

  async isGhostMode(chatId: string, userId: string): Promise<boolean> {
    const key = redisRoomKey(chatId, "ghosts");
    return (await this.redis.sismember(key, userId)) === 1;
  }

  async getAllGhosts(chatId: string): Promise<string[]> {
    const key = redisRoomKey(chatId, "ghosts");
    return this.redis.smembers(key);
  }

  // --- Ban Management ---
  async banUser(chatId: string, userId: string) {
    return this.redis.sadd(redisRoomKey(chatId, "banned_users"), userId);
  }

  async isUserBanned(chatId: string, userId: string): Promise<boolean> {
    return (await this.redis.sismember(redisRoomKey(chatId, "banned_users"), userId)) === 1;
  }

  async banIp(chatId: string, ip: string) {
    return this.redis.sadd(redisRoomKey(chatId, "banned_ips"), ip);
  }

  async isIpBanned(chatId: string, ip: string): Promise<boolean> {
    return (await this.redis.sismember(redisRoomKey(chatId, "banned_ips"), ip)) === 1;
  }

  // --- Theme Management ---
  async setTheme(chatId: string, theme: ChatThemeV2, mode: "light" | "dark") {
    const key = redisRoomKey(chatId, "info");
    await this.redis.hset(key, "theme", JSON.stringify(theme));
    await this.redis.hset(key, "mode", mode);
  }

  async getTheme(chatId: string): Promise<{ theme: ChatThemeV2 | null; mode: "light" | "dark" }> {
    const [themeString, mode] = await this.redis.hmget(redisRoomKey(chatId, "info"), "theme", "mode");
    let theme: ChatThemeV2 | null = null;
    if (themeString && themeString !== "[object Object]" && themeString !== "null" && themeString !== "{}") {
      try {
        theme = JSON.parse(themeString);
        if (theme && Object.keys(theme).length === 0) theme = null;
      } catch (error) {
        console.error(`[${chatId}] Failed to parse theme JSON from Redis:`, error);
        theme = null;
      }
    }
    const validMode = mode === "light" || mode === "dark" ? mode : "light";
    return { theme, mode: validMode };
  }
}