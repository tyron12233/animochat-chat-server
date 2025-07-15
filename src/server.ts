import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import expressWs from "express-ws"; // Import express-ws
import { initialize } from "./config/redis";
import { onConnection } from "./socket";
import type { ChatWebSocket } from "./chat-room";
import router from "./routes/routes";
import addStatusEndPoint, { startServiceRegistration } from "./service";

dotenv.config();

const { app, getWss, applyTo } = expressWs(express());
// Apply express-ws middleware
expressWs(app);

app.set("trust proxy", true);

app.use(
  cors({
    credentials: true,
    origin: process.env.CORS_ORIGIN || "https://chat.tyronscott.me",
  })
);
app.use(express.json());

await initialize();

// Define the WebSocket route
app.ws("/", (ws, req) => {
  // express-ws provides query params directly on the request object
  const { chatId, userId } = req.query;

  // 'trust proxy' allows Express to correctly get the IP from x-forwarded-for
  const ip = req.ip;

  // Validate required parameters
  if (!chatId || !userId) {
    // Close the connection with a reason
    ws.close(4000, "Bad Request: Missing chatId or userId");
    return;
  }

  // Augment the WebSocket object with custom properties
  const cws: ChatWebSocket = ws as ChatWebSocket;
  cws.chatId = chatId as string;
  cws.userId = userId as string;
  cws.ipAddress = req.ip;

  // Pass the augmented WebSocket and request to your connection handler
  onConnection(cws, req);
});

app.use("/", router);

addStatusEndPoint(app);

// Use app.listen directly, as express-ws integrates with the Express server
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server is running on port ${process.env.PORT || 3000}`);

  startServiceRegistration();
});
