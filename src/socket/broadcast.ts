import { WebSocket } from 'ws';
import * as userStore from '../userStore';
import type { Message, Packet } from '../types';

/**
 * Sends a message to all connected clients in a specific room.
 * @param roomId The room to broadcast to.
 * @param message The message object to send.
 * @param excludeWs An optional WebSocket to exclude from the broadcast (usually the sender).
 */
export function broadcastToRoom(roomId: string, message: Packet<any, any>, excludeWs?: WebSocket) {
  const socketsInRoom = userStore.getSocketsInRoom(roomId);
  const messageString = JSON.stringify(message);

  for (const socket of socketsInRoom) {
    if (socket !== excludeWs && socket.readyState === WebSocket.OPEN) {
      socket.send(messageString);
    }
  }
}

export function sendSystemMessage(roomId: string, content: string) {
  const message: Packet<Message, "message"> = {
    type: 'message',
    content: {
      content: content,
      created_at: new Date().toISOString(),
      id: "system_" + Date.now(),
      session_id: roomId,
      sender: 'system',
    },
    sender: 'system',
  };

  broadcastToRoom(roomId, message);
}