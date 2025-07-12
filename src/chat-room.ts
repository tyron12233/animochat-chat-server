import WebSocket from "ws";
import { generateUserFriendlyName } from "./util";

export interface ChatWebSocket extends WebSocket {
  userId: string;
  chatId: string;
  ipAddress?: string;
}

