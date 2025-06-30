import Redis from "ioredis";
import { ChatRoomRepository } from "./src/chat-room-repository";

async function runCleanup() {
  console.log("Connecting to Redis...");
  const redis = new Redis(process.env.REDIS_URL!);
  const roomRepo = new ChatRoomRepository(redis);

  console.log("Fetching all existing room IDs...");
  const allRoomIds = await roomRepo.getAllRoomIds();
  console.log(`Found ${allRoomIds.length} total rooms.`);

  // Filter the list to find only the rooms that need to be deleted.
  const roomsToDelete = allRoomIds.filter(
    (id: any) => !id.startsWith("room-")
  );

  if (roomsToDelete.length === 0) {
    console.log("✅ No rooms to clean up. All rooms are correctly prefixed.");
    await redis.quit();
    return;
  }

  console.log(`\nFound ${roomsToDelete.length} rooms to delete. Starting cleanup...`);

  // Loop through the filtered list and delete each room.
  for (const chatId of roomsToDelete) {
    await roomRepo.deleteRoom(chatId);
  }

  console.log("\n✅ Cleanup complete!");
  console.log(`Successfully deleted ${roomsToDelete.length} rooms.`);

  // Disconnect from Redis
  await redis.quit();
}

// Execute the script and handle any potential errors.
runCleanup().catch((error) => {
  console.error("An error occurred during the cleanup process:", error);
  process.exit(1); // Exit with an error code
});
