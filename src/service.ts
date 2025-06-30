import os from "os";
import {type Express } from "express";
import type { ChatWebSocket } from "./chat-room";
import type { ChatRoomRepository } from "./chat-room-repository";


export const CHAT_SERVER_PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : 8080;

export const DISCOVERY_SERVER_URL =
  process.env.DISCOVERY_SERVER_URL ||
  "https://animochat-service-discovery.onrender.com";
export const SERVICE_NAME = "chat-service";
export const SERVICE_VERSION = "1.0.0";
export const SERVICE_URL =
  process.env.SERVICE_URL || `http://localhost:${CHAT_SERVER_PORT}`;


  const registerService = async () => {
  try {
    const response = await fetch(`${DISCOVERY_SERVER_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceName: SERVICE_NAME,
        version: SERVICE_VERSION,
        url: SERVICE_URL,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to register service. Status: ${
          response.status
        } ${await response.text()}`
      );
    }
    console.log(
      "Service registered/heartbeat sent successfully to discovery server."
    );
  } catch (error) {
    console.error("Failed to register service:", (error as Error).message);
  }
};

const unregisterService = async () => {
  try {
    const response = await fetch(`${DISCOVERY_SERVER_URL}/unregister`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceName: SERVICE_NAME,
        version: SERVICE_VERSION,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to unregister service. Status: ${response.status}`
      );
    }
    console.log("Service unregistered successfully from discovery server.");
  } catch (error) {
    console.error("Failed to unregister service:", (error as Error).message);
  }
};

export async function startServiceRegistration() {
    await registerService();

    setInterval(registerService, 10000);

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
        await unregisterService();
        process.exit();
    });

    process.on("SIGTERM", async () => {
        await unregisterService();
        process.exit();
    });
}

type ActiveConnectionsMap = Map<string, Map<string, Set<ChatWebSocket>>>;
 

export default function addStatusEndPoint(
  app: Express,
  // MODIFICATION: Changed function signature to accept the repository and connections map
  roomRepo: ChatRoomRepository,
  activeConnections: ActiveConnectionsMap
) {
  // MODIFICATION: The entire handler is now async to await data from Redis
  app.get("/status", async (req, res) => {
    // --- Helper Functions for Metrics (Unchanged) ---
     const formatBytes = (bytes: number): string => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
      };
    
      const formatUptime = (seconds: number): string => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${d}d ${h}h ${m}m ${s}s`;
      };

    const memoryUsage = process.memoryUsage();
    
    // MODIFICATION: Fetch room data asynchronously
    const allRoomIds = await roomRepo.getAllRoomIds();
    
    const roomsData = await Promise.all(
        allRoomIds.map(async (chatId: string) => {
            const participants = await roomRepo.getParticipantCount(chatId);
            const info = await roomRepo.getRoomInfo(chatId);
            
            // Calculate connections for THIS instance
            let totalConnections = 0;
            const roomConnections = activeConnections.get(chatId);
            if (roomConnections) {
                for (const userConnections of roomConnections.values()) {
                    totalConnections += userConnections.size;
                }
            }

            return {
                chatId,
                participants,
                totalConnections, // Note: This is connections to THIS server instance only
            };
        })
    );

    const statusPayload = {
      totalRooms: allRoomIds.length,
      rooms: roomsData, // Use the new asynchronously fetched data
     serviceName: SERVICE_NAME,
            version: SERVICE_VERSION,
            timestamp: new Date().toISOString(),
            uptime: formatUptime(process.uptime()),
            processMemory: {
                rss: `${formatBytes(memoryUsage.rss)} (Resident Set Size)`,
                heapTotal: `${formatBytes(memoryUsage.heapTotal)} (Total V8 Heap)`,
                heapUsed: `${formatBytes(memoryUsage.heapUsed)} (Used V8 Heap)`,
                external: `${formatBytes(memoryUsage.external)} (C++ Objects)`,
            },
            os: {
                hostname: os.hostname(),
                platform: os.platform(),
                totalMemory: formatBytes(os.totalmem()),
                freeMemory: formatBytes(os.freemem()),
                cpuCount: os.cpus().length,
                loadAverage: os.loadavg(),
            },
            cpuUsage: process.cpuUsage(),
    };
    res.json(statusPayload);
  });
}
