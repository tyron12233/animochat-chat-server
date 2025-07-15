import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { initialize } from "./config/redis";
import { onConnection } from "./socket";
import type { ChatWebSocket } from "./chat-room";
import router from "./routes/routes";
import addStatusEndPoint, { startServiceRegistration } from "./service";

dotenv.config();

const app = express();
app.set("trust proxy", true);

app.use(
  cors({
    credentials: true,
    origin: process.env.CORS_ORIGIN || "https://chat.tyronscott.me",
  })
);
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

await initialize();

wss.on("connection", onConnection);

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const chatId = url.searchParams.get("chatId");
  const userId = url.searchParams.get("userId");
  let ip: string | undefined;
  if (request.headers["x-forwarded-for"]) {
    // If behind a proxy, use X-Forwarded-For. Take the first IP in the list.
    const forwardedIps = (request.headers["x-forwarded-for"] as string).split(
      ","
    );
    ip = forwardedIps[0]?.trim();
  } else {
    // If no proxy, use the direct socket remoteAddress
    ip = request.socket.remoteAddress;
  }

  if (!chatId || !userId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Defer to the WebSocket server to handle the handshake.
  wss.handleUpgrade(request, socket, head, (ws) => {
    const cws: ChatWebSocket = ws as ChatWebSocket;
    cws.chatId = chatId;
    cws.userId = userId;
    cws.ipAddress = ip;
    wss.emit("connection", cws, request);
  });
});

app.use("/", router);

addStatusEndPoint(app);

server.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server is running on port ${process.env.PORT || 3000}`);

  startServiceRegistration();
});
