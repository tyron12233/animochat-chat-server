import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import http from "http";
import express from "express";
import { IncomingMessage } from "http";
import cors from "cors";
import { Redis } from "ioredis";
import dotenv from "dotenv";
import type {
  ChangeThemePacket,
  Message,
  MessagesSyncPacket,
  Participant,
  ParticipantsSyncPacket,
} from "./types";
import { ChatRoomRepository } from "./chat-room-repository"; // Our new repository
import addStatusEndPoint, {
  CHAT_SERVER_PORT,
  startServiceRegistration,
} from "./service";
import type { ChatWebSocket } from "./chat-room";

dotenv.config();

// --- Initialization ---
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// 1. Initialize Redis and the Repository
const redis = new Redis(process.env.REDIS_URL!);
const roomRepo = new ChatRoomRepository(redis);

/**
 * This Map now only stores active connections for THIS server instance.
 * It does NOT store persistent chat data like messages or room settings.
 * Structure: Map<chatId, Map<userId, Set<ChatWebSocket>>>
 */
const activeConnections = new Map<string, Map<string, Set<ChatWebSocket>>>();

// --- Helper function for broadcasting ---
function broadcast(chatId: string, message: string, excludeUserId?: string) {
  const roomConnections = activeConnections.get(chatId);
  if (!roomConnections) return;

  roomConnections.forEach((connections, userId) => {
    if (userId === excludeUserId) return;
    connections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
}

// --- Express Endpoints (Refactored) ---

addStatusEndPoint(app, roomRepo, activeConnections);

app.get("/rooms", async (req, res) => {
  const publicRooms = await roomRepo.listPublicRooms();
  const roomsWithOnlineCount = publicRooms.map((room) => {
    const roomConnections = activeConnections.get(room.id);
    const onlineParticipants = roomConnections ? roomConnections.size : 0;
    return {
      id: room.id,
      name: room.name,
      max_participants: room.max_participants,
      participants: onlineParticipants,
    };
  });
  res.json(roomsWithOnlineCount);
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "what are you trying to do here? :p",
  })
})

app.post("/create-room", async (req, res) => {
  const { name, maxParticipants } = req.body;
  if (!name || !maxParticipants) {
    res.status(400).json({ error: "Name and maxParticipants are required" });
    return;
  }

  const chatId = `room-${Date.now()}`;
  await roomRepo.createRoom(chatId, name, maxParticipants);
  // If it's a public group chat, add it to the public list
  if (maxParticipants > 2) {
    await roomRepo.makeRoomPublic(chatId);
  }

  res.status(201).json({ id: chatId, name, max_participants: maxParticipants });
});

app.post("/ban/:chatId/:userId", async (req, res) => {
  const { chatId, userId } = req.params;

  if (!(await roomRepo.roomExists(chatId))) {
    res.status(404).json({ error: "Chat room not found" });
    return;
  }

  if (await roomRepo.isUserBanned(chatId, userId)) {
    res.status(400).json({ error: "User is already banned" });
    return;
  }

  await roomRepo.banUser(chatId, userId);

  // Disconnect the user if they are currently connected to this instance
  const roomConnections = activeConnections.get(chatId);
  const userConnections = roomConnections?.get(userId);
  userConnections?.forEach((conn) => {
    conn.close(1008, "You have been banned from this room.");
  });

  // Notify others
  const nickname = await roomRepo.getNickname(chatId, userId);
  const notification = JSON.stringify({
    type: "STATUS",
    message: `${nickname || "A user"} has been banned.`,
  });
  broadcast(chatId, notification);

  res.status(200).json({ message: `User ${nickname} has been banned.` });
});

app.get("/sync/:chatId", async (req, res) => {
  const { chatId } = req.params;

  if (!(await roomRepo.roomExists(chatId))) {
    res.status(404).json({ error: "Chat room not found" });
    return;
  }

  // Fetch the latest 50 messages to display on screen
  const messagesToDisplay = 50;
  let messages = await roomRepo.getMessages(chatId, 0, messagesToDisplay - 1);

  // Check the total number of persisted messages
  const totalMessageCount = await roomRepo.getMessageCount(chatId);

  // If the total message count is greater than the number we are displaying,
  // it means the history is truncated.
  if (totalMessageCount > messagesToDisplay) {
    // Create the system message
    const truncationMessage: Message = {
      type: "system",
      content: `Message history is limited to the last 100 messages. Total: ${totalMessageCount}`,
      sender: "system",
      created_at: new Date().toISOString(),
      session_id: chatId,
      id: `truncated-${Date.now()}`,
    };
    // Replace the oldest message in the current view with our system message.
    // Since the array is chronological, the first item is the oldest.
    if (messages.length > 0) {
      messages[0] = truncationMessage;
    } else {
      messages.push(truncationMessage);
    }
  }

  const messagesSyncPacket: MessagesSyncPacket = {
    type: "messages_sync",
    sender: "system",
    content: messages,
  };

  const themeInfo = await roomRepo.getTheme(chatId);

  res.json({
    theme: themeInfo.theme || null,
    mode: themeInfo.mode || "light",
    messages: messagesSyncPacket,
  });
});

// --- WebSocket Upgrade Handling (No changes needed) ---
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

// --- WebSocket Connection Logic (Refactored) ---
wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const chatWs = ws as ChatWebSocket;
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const chatId = url.searchParams.get("chatId")!;
  const userId = url.searchParams.get("userId")!;
  // ... other params

  chatWs.userId = userId;

  // --- Room and User Management with Redis ---
  const roomExists = await roomRepo.roomExists(chatId);
  if (!roomExists) {
    // Auto-create 1-on-1 rooms
    const roomName = url.searchParams.get("name") || `Chat with ${userId}`;
    const maxParticipants = parseInt(
      url.searchParams.get("maxParticipants") || "2",
      10
    );
    await roomRepo.createRoom(chatId, roomName, maxParticipants);
    console.log(`[${chatId}] Room auto-created.`);
  }

  // Check bans first
  if (await roomRepo.isUserBanned(chatId, userId)) {
    ws.close(1008, "You are banned from this room.");
    return;
  }
  const ip = req.socket.remoteAddress;
  if (ip && (await roomRepo.isIpBanned(chatId, ip))) {
    ws.close(1008, "Your IP is banned from this room.");
    return;
  }

  // --- Manage local connection state ---
  if (!activeConnections.has(chatId)) {
    activeConnections.set(chatId, new Map());
  }
  const roomConnections = activeConnections.get(chatId)!;
  if (!roomConnections.has(userId)) {
    roomConnections.set(userId, new Set());
  }
  roomConnections.get(userId)!.add(chatWs);
  // ---

  // Check if room is full
  const roomInfo = await roomRepo.getRoomInfo(chatId);
  const participantCount = await roomRepo.getParticipantCount(chatId);
  const maxParticipants = parseInt(roomInfo.maxParticipants ?? "2", 10);
  if (
    participantCount >= maxParticipants &&
    !(await roomRepo.getParticipantIds(chatId)).includes(userId)
  ) {
    ws.close(1008, "Room is full.");
    return;
  }

  // Add user to persistent participant list if they are not already there
  if (!(await roomRepo.getParticipantIds(chatId)).includes(userId)) {
    const { generateUserFriendlyName } = await import("./util");
    await roomRepo.addParticipant(chatId, userId, generateUserFriendlyName());
  }

  console.log(`[${chatId}] User '${userId}' connected.`);

  // Sync participants to the newly connected client
  const nicknamesMap = (await roomRepo.getNicknames(chatId)) as Map<
    string,
    string
  >;
  const participants: Omit<Participant, "connections">[] = Array.from(
    nicknamesMap.entries()
  ).map(([uid, nickname]) => ({ userId: uid, nickname }));

  ws.send(
    JSON.stringify({
      type: "participants_sync",
      content: participants,
      sender: "system",
    } as ParticipantsSyncPacket)
  );

  // Broadcast to others that a user has joined
  const joinedPacket = {
    type: "participant_joined",
    content: { userId, nickname: await roomRepo.getNickname(chatId, userId) },
    sender: "system",
  };
  broadcast(chatId, JSON.stringify(joinedPacket));

  ws.on("message", async (message: Buffer) => {
    const parsedMessage = message.toString();
    try {
      const packet = JSON.parse(parsedMessage);

      // Handle different packet types by calling the repository
      if (packet.type === "message") {
        await roomRepo.addMessage(chatId, packet.content);
        // Broadcast to other connections on this and other servers
        broadcast(chatId, parsedMessage, userId);
      } else if (packet.type === "change_nickname") {
        const { newNickname } = packet.content;
        await roomRepo.setNickname(chatId, userId, newNickname);
        // Broadcast the change
        broadcast(chatId, parsedMessage);
      } else if (packet.type === "change_theme") {
        const { mode, theme } = (packet as ChangeThemePacket).content;
        await roomRepo.setTheme(chatId, theme, mode);
        broadcast(chatId, parsedMessage);
      } else  if (packet.type === "disconnect") {
        if (roomInfo.maxParticipants && parseInt(roomInfo.maxParticipants) > 2) {
          await roomRepo.markClosed(chatId);
          console.log(`[${chatId}] Room marked as closed due to disconnect.`);
        }
        broadcast(chatId, parsedMessage);
      } else {
        // Broadcast other ephemeral packets like typing, theme changes etc.
        broadcast(chatId, parsedMessage, userId);
      }
    } catch (e) {
      console.error(`[${chatId}] Failed to parse message from '${userId}':`, e);
    }
  });

  // --- Disconnection Handling ---
  ws.on("close", async () => {
    const userId = chatWs.userId;
    if (!userId) {
      console.warn(`[${chatId}] Disconnected WebSocket without userId.`);
      return;
    }

    const roomConnections = activeConnections.get(chatId);
    if (!roomConnections) {
      console.log(
        `[${chatId}] Room not in activeConnections on disconnect for user ${userId}. Already cleared.`
      );
      return;
    }

    const userConnectionSet = roomConnections.get(userId);
    if (!userConnectionSet) {
      console.warn(
        `[${chatId}] User ${userId} not in roomConnections on disconnect.`
      );
      return;
    }

    userConnectionSet.delete(chatWs);
    console.log(
      `[${chatId}] Removed one connection for user ${userId}. Remaining on this instance: ${userConnectionSet.size}`
    );

    // If this was the user's VERY LAST connection on THIS server instance...
    if (userConnectionSet.size === 0) {
      console.log(
        `[${chatId}] User ${userId} has no more connections on this instance. Cleaning up.`
      );

      // Remove the user from this instance's room tracking.
      // This is the action that makes the participant count go down.
      roomConnections.delete(userId);

      // Announce user offline status to others in the room.
      // NOTE: In a multi-server setup, a user might still be connected to another server.
      // A robust global presence system would use Redis Pub/Sub to coordinate this.
      // For a single instance, this is correct.
      const offlinePacket = {
        type: "offline",
        content: userId,
        sender: "system",
      };
      broadcast(chatId, JSON.stringify(offlinePacket));
      console.log(
        `[${chatId}] User '${userId}' fully disconnected from instance. Broadcast 'offline'.`
      );

      // If the room is now empty on this instance, clean it up from memory.
      if (roomConnections.size === 0) {
        activeConnections.delete(chatId);
        console.log(
          `[${chatId}] Room is now empty. Removed from activeConnections.`
        );

        const roomInfo = await roomRepo.getRoomInfo(chatId);
        const maxParticipants = parseInt(roomInfo.maxParticipants ?? "0", 10);
        const roomClosed = await roomRepo.isRoomClosed(chatId);
        if (maxParticipants === 2 && roomClosed) {
          await roomRepo.deleteRoom(chatId);
        }
      }
    }
  });

  ws.on("error", (error) => {
    console.error(
      `[${chatId}] An error occurred for user '${chatWs.userId}':`,
      error
    );
  });
});

server.listen(CHAT_SERVER_PORT, () => {
  console.log(
    `Express and WebSocket Server is running on port ${CHAT_SERVER_PORT}`
  );
  console.log(
    `WebSocket connections at ws://localhost:${CHAT_SERVER_PORT}?chatId=...&userId=...`
  );
  console.log(`Check status at http://localhost:${CHAT_SERVER_PORT}/status`);

  startServiceRegistration();
});
