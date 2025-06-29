import os from "os";
import {type Express } from "express";


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

export default function addStatusEndPoint(app: Express, chatRooms: Map<string, any>) {
    app.get("/status", (req, res) => {
      // --- Helper Functions for Metrics ---
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
    
      const roomsStatus = {
        totalRooms: chatRooms.size,
        rooms: Array.from(chatRooms.values()).map((room) => ({
          chatId: room.chatId,
          participants: room.getParticipantCount(),
          totalConnections: room.getTotalConnectionCount(),
          theme: room.theme,
        })),
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
      res.json(roomsStatus);
    })
}