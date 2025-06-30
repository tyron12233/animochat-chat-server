import { Redis } from "ioredis";
import type { Message, ChatThemeV2, Participant, ChatRoomInfo, PublicRoomInfo } from "./types";

// Helper function for consistent key naming
const roomKey = (chatId: string, suffix: string) => `chat:${chatId}:${suffix}`;

export class ChatRoomRepository {
  private redis: Redis;

  constructor(redisClient: Redis) {
    this.redis = redisClient;
  }

  // --- Room Management ---

  // mark this room is closed
  // e.g when a 1-on-1 chat is closed, we mark it as closed
  // so that it can be deleted when the last participant leaves.
  async markClosed(chatId: string) {
    const key = roomKey(chatId, "info");
    return this.redis.hset(key, "closed", "true");
  }

  async isRoomClosed(chatId: string): Promise<boolean> {
    const key = roomKey(chatId, "info");
    const closed = await this.redis.hget(key, "closed");
    return closed === "true";
  }

  async createRoom(chatId: string, name: string, maxParticipants: number) {
    const key = roomKey(chatId, "info");
    // HSET sets multiple fields in a hash.
    // We stringify the theme object for storage.
    return this.redis.hset(key, {
      name,
      maxParticipants,
      theme: null, // Default empty theme
      mode: "light",
    });
  }

    
  async deleteRoom(chatId: string) {
    const keysToDelete = [
      roomKey(chatId, "info"),
      roomKey(chatId, "messages"),
      roomKey(chatId, "participants"),
      roomKey(chatId, "nicknames"),
      roomKey(chatId, "banned_users"),
      roomKey(chatId, "banned_ips"),
    ];
    
    const pipeline = this.redis.pipeline();
    pipeline.del(...keysToDelete); // Delete all room-specific data
    pipeline.srem("public_rooms", chatId); // Remove from public list just in case
    
    await pipeline.exec();
    console.log(`[${chatId}] DELETED room from Redis because it was a 1-on-1 and is now empty.`);
  }


  async roomExists(chatId: string): Promise<boolean> {
    const key = roomKey(chatId, "info");
    return (await this.redis.exists(key)) === 1;
  }

  async listPublicRooms(): Promise<PublicRoomInfo[]> {
    const publicRoomIds = await this.redis.smembers('public_rooms');

    if (publicRoomIds.length === 0) {
      return [];
    }

    const rooms = await Promise.all(
      publicRoomIds.map(async (chatId) => {
        // We only need the name and maxParticipants from the info hash now
        const [name, maxParticipantsStr] = await this.redis.hmget(
          roomKey(chatId, 'info'),
          'name',
          'maxParticipants'
        );

        if (!name) return null; // Skip if room info doesn't exist

        return {
          id: chatId,
          name: name,
          max_participants: parseInt(maxParticipantsStr ?? "10", 10) || 2,
        };
      })
    );

    // Filter out any nulls
    return rooms.filter((room): room is PublicRoomInfo => room !== null);
  }

  async makeRoomPublic(chatId: string) {
    return this.redis.sadd("public_rooms", chatId);
  }

  async getRoomInfo(chatId: string) {
    const key = roomKey(chatId, "info");
    return this.redis.hgetall(key);
  }

  // --- Message Management ---

  async addMessage(chatId: string, message: Message) {
    const key = roomKey(chatId, "messages");
    await this.redis.lpush(key, JSON.stringify(message));

    // LTRIM keeps the elements from in x 0 to 99 (100 total).
    // Since LPUSH adds to the front, this automatically discards the oldest messages.
    await this.redis.ltrim(key, 0, 99);
  }

  async getMessages(
    chatId: string,
    start: number,
    end: number
  ): Promise<Message[]> {
    const key = roomKey(chatId, "messages");
    const results = await this.redis.lrange(key, start, end);
    // Parse the JSON strings back into Message objects.
    return results.map((msg: string) => JSON.parse(msg)).reverse(); // Reverse to get chronological order
  }

  async getMessageCount(chatId: string): Promise<number> {
    const key = roomKey(chatId, "messages");
    return this.redis.llen(key);
  }

  // --- Participant & Nickname Management ---

  async addParticipant(
    chatId: string,
    userId: string,
    initialNickname: string
  ) {
    // Add to the set of participants in the room
    await this.redis.sadd(roomKey(chatId, "participants"), userId);
    // Set their nickname
    await this.redis.hset(
      roomKey(chatId, "nicknames"),
      userId,
      initialNickname
    );
  }

  async removeParticipant(chatId: string, userId: string) {
    return this.redis.srem(roomKey(chatId, "participants"), userId);
  }

  async getParticipantIds(chatId: string): Promise<string[]> {
    return this.redis.smembers(roomKey(chatId, "participants"));
  }

  async getParticipantCount(chatId: string): Promise<number> {
    return this.redis.scard(roomKey(chatId, "participants"));
  }

  async getNicknames(chatId: string): Promise<Map<string, string>> {
    const nicknamesHash = await this.redis.hgetall(
      roomKey(chatId, "nicknames")
    );
    return new Map(Object.entries(nicknamesHash));
  }

  async getNickname(chatId: string, userId: string): Promise<string | null> {
    return this.redis.hget(roomKey(chatId, "nicknames"), userId);
  }

  async setNickname(chatId: string, userId: string, newNickname: string) {
    return this.redis.hset(roomKey(chatId, "nicknames"), userId, newNickname);
  }

  // --- Ban Management ---

  async banUser(chatId: string, userId: string) {
    return this.redis.sadd(roomKey(chatId, "banned_users"), userId);
  }

  async isUserBanned(chatId: string, userId: string): Promise<boolean> {
    return (
      (await this.redis.sismember(roomKey(chatId, "banned_users"), userId)) ===
      1
    );
  }

  async banIp(chatId: string, ip: string) {
    return this.redis.sadd(roomKey(chatId, "banned_ips"), ip);
  }

  async isIpBanned(chatId: string, ip: string): Promise<boolean> {
    return (
      (await this.redis.sismember(roomKey(chatId, "banned_ips"), ip)) === 1
    );
  }

  // --- Theme Management ---
  async setTheme(chatId: string, theme: ChatThemeV2, mode: "light" | "dark") {
    const key = roomKey(chatId, "info");
    await this.redis.hset(key, "theme", JSON.stringify(theme));
    await this.redis.hset(key, "mode", mode);
  }


  async getTheme(chatId: string): Promise<{ theme: ChatThemeV2 | null; mode: "light" | "dark" }> {
    const [themeString, mode] = await this.redis.hmget(
      roomKey(chatId, 'info'),
      'theme',
      'mode'
    );

    let theme: ChatThemeV2 | null = null;
    
    if (themeString) {
      // Explicitly check for the corrupted "[object Object]" string or null/empty values.
      if (themeString === '[object Object]' || themeString === "null" || themeString === "{}") {
        theme = null;
      } else {
        try {
          theme = JSON.parse(themeString);
          // Also treat a successfully parsed but empty object as null.
          if (theme && Object.keys(theme).length === 0) {
            theme = null;
          }
        } catch (error) {
          console.error(`[${chatId}] Failed to parse theme JSON from Redis:`, error);
          // If parsing fails for any other reason, ensure the theme is null.
          theme = null; 
        }
      }
    }

    const validMode = mode === "light" || mode === "dark" ? mode : "light";
    return {
      theme: theme,
      mode: validMode
    };
  }

  async getAllRoomIds(): Promise<string[]> {
    const roomIds: string[] = [];
    let cursor = "0";
    do {
      // Scan for keys matching the pattern 'chat:*:info'
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        "chat:*:info",
        "COUNT",
        100
      );
      for (const key of keys) {
        // Extract the chatId from the key (e.g., 'chat:room-123:info' -> 'room-123')
        const chatId = key.split(":")[1];
        if (chatId) {
          roomIds.push(chatId);
        }
      }
      cursor = newCursor;
    } while (cursor !== "0");
    return roomIds;
  }
}
