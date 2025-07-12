// src/store/userStore.ts
import { WebSocket } from 'ws';

interface User {
  id: string;
}

interface SocketInfo {
  userId: string;
  roomId: string;
}

// roomId -> (userId -> WebSocket[])
const rooms = new Map<string, Map<string, WebSocket[]>>();
// WebSocket -> { userId, roomId }
const socketToInfo = new Map<WebSocket, SocketInfo>();

export function addUserToRoom(ws: WebSocket, userId: string, roomId: string): void {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map<string, WebSocket[]>());
  }
  const roomUsers = rooms.get(roomId)!;

  if (!roomUsers.has(userId)) {
    roomUsers.set(userId, []);
  }
  const userSockets = roomUsers.get(userId)!;
  
  userSockets.push(ws);
  socketToInfo.set(ws, { userId, roomId });
}

export function removeUser(ws: WebSocket): SocketInfo | undefined {
  const info = socketToInfo.get(ws);
  if (!info) return;

  const { userId, roomId } = info;
  const roomUsers = rooms.get(roomId);
  if (!roomUsers || !roomUsers.has(userId)) return info;

  const userSockets = roomUsers.get(userId)!;
  const filteredSockets = userSockets.filter(socket => socket !== ws);

  if (filteredSockets.length === 0) {
    roomUsers.delete(userId);
  } else {
    roomUsers.set(userId, filteredSockets);
  }

  if (roomUsers.size === 0) {
    rooms.delete(roomId);
  }

  socketToInfo.delete(ws);
  return info;
}

export function getOnlineUsersInRoom(roomId: string): User[] {
  const roomUsers = rooms.get(roomId);
  return roomUsers ? Array.from(roomUsers.keys()).map(id => ({ id })) : [];
}

export function getSocketsInRoom(roomId: string): WebSocket[] {
  const roomUsers = rooms.get(roomId);
  if (!roomUsers) return [];
  // Flatten the map of users and their socket arrays into a single array of WebSockets
  return Array.from(roomUsers.values()).flat();
}

export function deleteRoom(roomId: string): void {
  if (rooms.has(roomId)) {
    rooms.delete(roomId);
  }
}