import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import http from "http";
import express from "express";
import { IncomingMessage } from "http";
import cors from "cors";
import type {
  ChangeThemePacket,
  ChatRoomInfo,
  ChatThemeV2,
  MessagesSyncPacket,
  OfflinePacket,
} from "./types";
import { ChatRoom, type ChatWebSocket } from "./chat-room";
import addStatusEndPoint, {
  CHAT_SERVER_PORT,
  startServiceRegistration,
} from "./service";

/**
 * This Map stores the active chat rooms.
 * The key is the 'chatId', and the value is the ChatRoom instance.
 * Structure: Map<chatId, ChatRoom>
 */
const chatRooms = new Map<string, ChatRoom>();

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// --- Express Status Endpoint ---
addStatusEndPoint(app, chatRooms);

app.get("/rooms", (req, res) => {
  // return all group chats (those who have greater than 2 max participants)
  const rooms: ChatRoomInfo[] = [];
  chatRooms.forEach((room) => {
    if (room.maxParticipants > 2) {
      rooms.push(room.getInfo());
    }
  });
  res.json(rooms);
});

// post endpoint to create a new chat room
app.post("/create-room", (req, res) => {
  const { name, maxParticipants } = req.body;
  if (!name || !maxParticipants) {
    res.status(400).json({ error: "Name and maxParticipants are required" });
    return;
  }

  const chatId = `room-${Date.now()}`;
  const newRoom = new ChatRoom(chatId, name, maxParticipants);
  chatRooms.set(chatId, newRoom);

  const roomInfo: ChatRoomInfo = newRoom.getInfo();
  res.status(201).json(roomInfo);
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

  // Extract all necessary parameters from the URL
  const chatId = url.searchParams.get("chatId")!;
  const userId = url.searchParams.get("userId")!;
  const roomName = url.searchParams.get("name") || `Chat with ${userId}`; // Default name
  const maxParticipants = parseInt(
    url.searchParams.get("maxParticipants") || "2",
    10
  ); // Default to 2 for 1-on-1 chat

  chatWs.userId = userId;
  console.log(
    `[${chatId}] User '${userId}' attempting to connect to room '${roomName}'...`
  );

  // --- Room and User Management ---
  // Get or create the ChatRoom instance. The first user to connect defines the room's properties.
  if (!chatRooms.has(chatId)) {
    // For backward compatibility, old clients will default to maxParticipants=2
    chatRooms.set(chatId, new ChatRoom(chatId, roomName, maxParticipants));
  }

  const room = chatRooms.get(chatId)!;

  if (room.theme) {
    const packet: ChangeThemePacket = {
      type: "change_theme",
      content: { theme: room.theme, mode: room.mode },
      sender: "system",
    };
    ws.send(JSON.stringify(packet));
  }

  try {
    // Add the user to the room. The ChatRoom class now handles capacity checks.
    const { isNewUser, userCount } = room.addUser(chatWs);
    console.log(
      `[${chatId}] User '${userId}' connected successfully. Room '${
        room.name
      }' has ${userCount} user(s) and ${room.getTotalConnectionCount()} total connection(s).`
    );

    // **BACKWARD COMPATIBILITY**: Only send the specific "partner has connected" message
    // for legacy 1-on-1 chats. Group chats get a generic "user_joined" packet from the ChatRoom class.
    if (room.maxParticipants === 2 && isNewUser && userCount === 2) {
      console.log(
        `[${chatId}] 1-on-1 room now has 2 users. Notifying partner.`
      );
      const notification = JSON.stringify({
        type: "STATUS",
        message: "Your partner has connected. You can now chat!",
      });
      // This broadcast goes to the other user.
      room.broadcast(chatWs, notification);
    }
  } catch (error) {
    // This catch block handles the case where the room is full.
    const errorMessage = (error as Error).message;
    console.error(
      `[${chatId}] Connection rejected for user '${userId}': ${errorMessage}`
    );
    ws.close(1008, errorMessage);
    return;
  }

  ws.on("message", (message: Buffer) => {
    const parsedMessage = message.toString();
    try {
      const packet = JSON.parse(parsedMessage);

      if (packet.type === "change_theme") {
        room.setTheme(packet.content.theme);
        room.setMode(packet.content.mode);
      } else if (packet.type === "message") {
        room.messages.push(packet.content);
      }

      // Broadcast all other packets to other users in the room
      room.broadcast(chatWs, parsedMessage);
    } catch (e) {
      console.error(
        `[${chatId}] Failed to parse message from '${chatWs.userId}':`,
        e
      );
    }
  });

  // --- Disconnection Handling ---
  ws.on("close", () => {
    const room = chatRooms.get(chatId);
    if (!room) return;

    room.removeUser(chatWs);

    const isOneToOneChat = room.maxParticipants === 2;
    // we only delete the room if it's a 1-on-1 chat and it becomes empty
    if (room.isEmpty() && isOneToOneChat) {
      console.log(
        `[${chatId}] Room '${room.name}' is now empty and has been closed.`
      );
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
