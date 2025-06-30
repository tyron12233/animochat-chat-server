/**
 * @fileoverview
 * This script connects to the Redis database to perform administrative tasks on chat rooms.
 * It deletes a specified room and then creates a new one with given parameters.
 *
 * To run this script:
 * 1. Make sure you have `ts-node` installed (`npm install -g ts-node`).
 * 2. Place this file in a `scripts` directory in your project root.
 * 3. Ensure your `.env` file with the `REDIS_URL` is present.
 * 4. Run from your project root: `ts-node scripts/manageRoom.ts`
 */

import { Redis } from 'ioredis';
import * as dotenv from 'dotenv';
// Adjust the import path to your ChatRoomRepository file if needed
import { ChatRoomRepository } from './src/chat-room-repository';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const ROOM_TO_DELETE_ID = 'room-1751225712881';

const NEW_ROOM_DETAILS = {
  name: 'shut it down v6',
  maxParticipants: 17,
};
// ---------------------

/**
 * A helper function to find and delete all Redis keys associated with a specific chat room.
 * @param redis The ioredis client instance.
 * @param chatId The ID of the room to delete.
 */
const deleteRoomCompletely = async (redis: Redis, chatId: string): Promise<void> => {
  console.log(`  -> Gathering all keys for room: ${chatId}...`);
  
  // A pipeline batches multiple commands into a single operation for efficiency.
  const pipeline = redis.pipeline();

  // Find all reaction hashes for the messages in this room and add them to the delete pipeline.
  // We use SCAN to avoid blocking the database on production systems.
  let cursor = '0';
  do {
    const [newCursor, reactionKeys] = await redis.scan(cursor, 'MATCH', `chat:${chatId}:message:*:reactions`, 'COUNT', 100);
    if (reactionKeys.length > 0) {
      pipeline.del(...reactionKeys);
    }
    cursor = newCursor;
  } while (cursor !== '0');

  // Add all the standard room keys to the delete pipeline.
  pipeline.del(
    `chat:${chatId}:info`,
    `chat:${chatId}:messages`,
    `chat:${chatId}:participants`,
    `chat:${chatId}:nicknames`,
    `chat:${chatId}:banned_users`,
    `chat:${chatId}:banned_ips`
  );
  
  // Remove the room from the list of public rooms.
  pipeline.srem('public_rooms', chatId);

  // Execute all the commands in the pipeline.
  await pipeline.exec();
  console.log(`  -> Deletion commands for room ${chatId} have been executed.`);
};

/**
 * The main function to run the management script.
 */
const manageRooms = async () => {
  if (!process.env.REDIS_URL) {
    console.error('Error: REDIS_URL is not defined in your .env file.');
    process.exit(1);
  }

  console.log(`Connecting to Redis...`);
  const redis = new Redis(process.env.REDIS_URL);
  const repo = new ChatRoomRepository(redis);

  try {
    // --- Step 1: Delete the old room ---
    console.log(`\n[TASK 1] Deleting room: ${ROOM_TO_DELETE_ID}`);
    await deleteRoomCompletely(redis, ROOM_TO_DELETE_ID); 
    
    // --- Step 2: Create the new room ---
    const newRoomId = `room-${Date.now()}`;
    console.log(`\n[TASK 2] Creating new room "${NEW_ROOM_DETAILS.name}"`);
    await repo.createRoom(
        newRoomId,
        NEW_ROOM_DETAILS.name,
        NEW_ROOM_DETAILS.maxParticipants
    );
    
    // Since maxParticipants > 2, we'll make it a public room.
    await repo.makeRoomPublic(newRoomId);

    console.log('  -> Room creation successful.');
    console.log('\n--- Summary ---');
    console.log('New Room Details:');
    console.log(`  ID: ${newRoomId}`);
    console.log(`  Name: ${NEW_ROOM_DETAILS.name}`);
    console.log(`  Max Participants: ${NEW_ROOM_DETAILS.maxParticipants}`);
    console.log('----------------\n');
    
  } catch (error) {
    console.error('\nAn error occurred during the script execution:', error);
  } finally {
    // Gracefully disconnect from Redis
    await redis.quit();
    console.log('Disconnected from Redis.');
  }
};

// Execute the main function
deleteRoomCompletely(new Redis(process.env.REDIS_URL!), "room-1751225712881")
