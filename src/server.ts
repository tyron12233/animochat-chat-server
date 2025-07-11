

import dotenv from "dotenv";
import cors from 'cors'
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { initialize } from "./config/redis";
import { onConnection } from "./socket";
import type { ChatWebSocket } from "./chat-room";
import router from "./routes/routes";
import addStatusEndPoint, { startServiceRegistration } from "./service";

dotenv.config();

const app = express();

app.use(cors())
app.use(express.json())

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

await initialize();


wss.on('connection', onConnection);

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
    const cws: ChatWebSocket = ws as ChatWebSocket;
    cws.chatId = chatId;
    cws.userId = userId;
    wss.emit("connection", cws, request);
  });
});

app.use("/", router);

addStatusEndPoint(app);

server.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Server is running on port ${process.env.PORT || 3000}`);

    startServiceRegistration();
});