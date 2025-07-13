import { Redis } from "ioredis";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { RedisChatRoomRepository } from "./src/repository/redis-impl";
import { SupabaseChatRoomRepository } from "./src/repository/supabase-impl";

// Load environment variables from a .env file
dotenv.config();

// --- Configuration ---
const {
  REDIS_URL,
  SUPABASE_URL,
  SUPABASE_KEY
} = process.env;

if (!REDIS_URL || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Please ensure REDIS_URL, SUPABASE_URL, and SUPABASE_KEY are set in your .env file."
  );
  process.exit(1);
}

// --- Main Migration Logic ---

async function migrate() {
  console.log("🚀 Starting migration from Redis to Supabase...");

  // 1. Initialize clients and repositories
  const redisClient = new Redis(REDIS_URL!);
  const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_KEY!);

  const redisRepo = new RedisChatRoomRepository(redisClient);
  const supabaseRepo = new SupabaseChatRoomRepository(supabaseClient);

  let migratedRooms = 0;
  let migratedMessages = 0;
  let migratedParticipants = 0;

  try {
    // 2. Get all room IDs from the source (Redis)
    const allRoomIds = await redisRepo.getAllRoomIds();
    console.log(`🔍 Found ${allRoomIds.length} rooms in Redis to migrate.`);

    // 3. Iterate over each room and migrate its data
    for (const chatId of allRoomIds) {
      console.log(`\n--- Migrating Room: ${chatId} ---`);

      // Check if room already exists in Supabase to prevent duplicates
      const roomExists = await supabaseRepo.roomExists(chatId);
      if (roomExists) {
        console.log(`🟡 Room '${chatId}' already exists in Supabase. Skipping room creation.`);
      } else {
        // --- Migrate Room Info ---
        const roomInfo = await redisRepo.getRoomInfo(chatId);
        if (!roomInfo.name || !roomInfo.maxParticipants) {
            console.error(`🔴 Skipping room ${chatId} due to missing name or maxParticipants.`);
            continue;
        }

        
        
        console.log(`  -> Creating room entry for '${roomInfo.name}'...`);
        let maxParticipants = parseInt(roomInfo.maxParticipants, 10);

        if (maxParticipants === 2) {
            console.log("Skipping room creation for 1-on-1 chats.");
            continue;
        }
        await supabaseRepo.createRoom(chatId, roomInfo.name, maxParticipants);

        // --- Migrate Theme, Public Status, and Closed Status ---
        const { theme, mode } = await redisRepo.getTheme(chatId);
        if (theme) {
            await supabaseRepo.setTheme(chatId, theme, mode);
        }

        // Note: Redis doesn't have a direct "isPublic" flag on the room hash.
        // We check the public_rooms set. This is less efficient but necessary.
        const publicRooms = await redisRepo.listPublicRooms();
        if (publicRooms.some(r => r.id === chatId)) {
            await supabaseRepo.makeRoomPublic(chatId);
            console.log("  -> Marked room as public.");
        }

        if (await redisRepo.isRoomClosed(chatId)) {
            await supabaseRepo.markClosed(chatId);
            console.log("  -> Marked room as closed.");
        }
      }

      // --- Migrate Participants and Nicknames ---
      const participantIds = await redisRepo.getParticipantIds(chatId);
      const nicknames = await redisRepo.getNicknames(chatId);
      const ghosts = await redisRepo.getAllGhosts(chatId);

      console.log(`  -> Migrating ${participantIds.length} participants...`);
      for (const userId of participantIds) {
        const nickname = nicknames.get(userId);
        if (nickname) {
          await supabaseRepo.addParticipant(chatId, userId, nickname);
          if (ghosts.includes(userId)) {
            await supabaseRepo.setGhostMode(chatId, userId, true);
          }
          migratedParticipants++;
        }
      }

      // --- Migrate Messages ---
      // getMessages in Redis repo takes start/end. 0, -1 gets all.
      const messages = await redisRepo.getMessages(chatId, 0, -1);
      console.log(`  -> Migrating ${messages.length} messages...`);
      if (messages.length > 0) {
        // The Supabase implementation of addMessage inserts one by one.
        // For bulk inserts, you might want to modify the Supabase repo
        // to accept an array of messages for better performance.
        for (const message of messages) {
          // The Supabase `addMessage` implementation will handle the mapping.
          // We just need to pass the full message object.
          await supabaseRepo.addMessage(chatId, message);
        }
        migratedMessages += messages.length;
      }
      
      // --- Migrate Bans ---
      // This requires scanning keys, which is not ideal in production Redis.
      // The provided Redis repo doesn't have a method to get all bans,
      // so we'll add a temporary one here for the script.
      const bannedUserIds = await redisClient.smembers(`chat:${chatId}:banned_users`);
      const bannedIps = await redisClient.smembers(`chat:${chatId}:banned_ips`);

      console.log(`  -> Migrating ${bannedUserIds.length} user bans and ${bannedIps.length} IP bans...`);
      for(const userId of bannedUserIds) {
        await supabaseRepo.banUser(chatId, userId);
      }
      for(const ip of bannedIps) {
        await supabaseRepo.banIp(chatId, ip);
      }

      migratedRooms++;
      console.log(`✅ Finished migrating room: ${chatId}`);
    }

    console.log("\n\n--- Migration Complete! ---");
    console.log(`📊 Total Rooms Migrated: ${migratedRooms}`);
    console.log(`✉️ Total Messages Migrated: ${migratedMessages}`);
    console.log(`👥 Total Participants Migrated: ${migratedParticipants}`);

  } catch (error) {
    console.error("\n❌ An error occurred during migration:", error);
  } finally {
    // 4. Close database connections
    await redisClient.quit();
    console.log("\nRedis connection closed.");
  }
}

// Run the migration
migrate();
