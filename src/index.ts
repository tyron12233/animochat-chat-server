import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import http from "http";
import express from "express";
import { IncomingMessage } from "http";
import cors from "cors";
import type { ChangeThemePacket, ChatThemeV2, MessagesSyncPacket, OfflinePacket } from "./types";
import { ChatRoom, type ChatWebSocket } from "./chat-room";
import os from "os";

const CHAT_SERVER_PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : 8080;

const DISCOVERY_SERVER_URL =
  process.env.DISCOVERY_SERVER_URL ||
  "https://animochat-service-discovery.onrender.com";
const SERVICE_NAME = "chat-service";
const SERVICE_VERSION = "1.0.0";
const SERVICE_URL =
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

/**
 * This Map stores the active chat rooms.
 * The key is the 'chatId', and the value is the ChatRoom instance.
 * Structure: Map<chatId, ChatRoom>
 */
const chatRooms = new Map<string, ChatRoom>();

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// --- Express Status Endpoint ---
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
});

// message sync endpoint
app.get("/sync/:chatId", (req, res) => {
  const chatId = req.params.chatId;
  const room = chatRooms.get(chatId);

  if (!room) {
    res.status(404).json({ error: "Chat room not found" });
    return;
  }

  const messagesSyncPacket: MessagesSyncPacket = {
    type: "messages_sync",
    sender: "system",
    content: room.messages,
  };

  res.json(messagesSyncPacket);
});

// --- WebSocket Upgrade Handling ---
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const chatId = url.searchParams.get("chatId");
  const userId = url.searchParams.get("userId");

  if (!chatId || !userId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Defer to the WebSocket server to handle the handshake.
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// --- WebSocket Connection Logic ---
wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const chatWs = ws as ChatWebSocket;
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const chatId = url.searchParams.get("chatId")!;
  const userId = url.searchParams.get("userId")!;

  let isExistingRoom = false;
  chatWs.userId = userId;

  console.log(`[${chatId}] User '${userId}' attempting to connect...`);

  // --- Room and User Management ---
  // Get or create the ChatRoom instance for the given chatId.
  if (!chatRooms.has(chatId)) {
    chatRooms.set(chatId, new ChatRoom(chatId));
  } else {
    isExistingRoom = true;
  }
  const room = chatRooms.get(chatId)!;

  if (isExistingRoom && room.theme) {
    const packet: ChangeThemePacket = {
      type: "change_theme",
      content: {
        theme: room.theme,
        mode: room.mode,
      },
      sender: "system",
    };
    ws.send(JSON.stringify(packet));
  }

  try {
    // Add the user to the room. The ChatRoom class handles the logic.
    const { isNewUser, userCount } = room.addUser(chatWs);
    console.log(
      `[${chatId}] User '${userId}' connected successfully. Room has ${userCount} user(s) and ${room.getTotalConnectionCount()} total connection(s).`
    );

    // Notify when the second user joins.
    if (isNewUser && userCount === 2) {
      console.log(
        `[${chatId}] Room now has 2 users. Notifying all participants.`
      );
      const notification = JSON.stringify({
        type: "STATUS",
        message: "Your partner has connected. You can now chat!",
      });
      room.broadcastToAll(notification);
    }
  } catch (error) {
    // This catch block handles the case where the room is full.
    console.error(
      `[${chatId}] Connection rejected for new user '${userId}': ${
        (error as Error).message
      }`
    );
    ws.close(1008, (error as Error).message);
    return;
  }

  // --- Message Handling ---
  ws.on("message", (message: Buffer) => {
    const parsedMessage = message.toString();
    const packet = JSON.parse(parsedMessage);

    if (packet.type === "change_theme") {
      room.setTheme(packet.content.theme);
      room.setMode(packet.content.mode);
    } else if (packet.type === "message") {
      room.messages.push(packet.content); 
    }

    room.broadcast(chatWs, parsedMessage);
  });

  // --- Disconnection Handling ---
  ws.on("close", () => {
    const room = chatRooms.get(chatId);
    if (!room) return;

    // The ChatRoom instance handles removing the user and notifying others.
    room.removeUser(chatWs);

    // If the room becomes empty, we clean it up.
    if (room.isEmpty()) {
      console.log(`[${chatId}] Room is now empty and has been closed.`);
      chatRooms.delete(chatId);
    }
  });

  // --- Error Handling ---
  ws.on("error", (error) => {
    console.error(
      `[${chatId}] An error occurred for user '${chatWs.userId}':`,
      error
    );
  });
});

setInterval(registerService, 10000);

process.on("SIGINT", async () => {
  await unregisterService();
  process.exit();
});

server.listen(CHAT_SERVER_PORT, () => {
  console.log(
    `Express and WebSocket Server is running on port ${CHAT_SERVER_PORT}`
  );
  console.log(
    `WebSocket connections at ws://localhost:${CHAT_SERVER_PORT}?chatId=...&userId=...`
  );
  console.log(`Check status at http://localhost:${CHAT_SERVER_PORT}/status`);

  registerService();
});
