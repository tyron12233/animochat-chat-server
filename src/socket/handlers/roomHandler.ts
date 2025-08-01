import type WebSocket from "ws";
import * as userStore from "../../userStore";
import type { ChatWebSocket } from "../../chat-room";
import { getChatRoomRepository } from "../../config/redis";
import { broadcastToRoom } from "../broadcast";
import { generateUserFriendlyName } from "../../util";
import type { ChatThemeV2, OfflinePacket } from "../../types";
import { BANNED_ROOM_CODE, ROOM_FULL_CODE } from "../../config/errors";

async function isUserBanned(
  chatId: string,
  userId: string,
  ip?: string
): Promise<boolean> {
  const repo = getChatRoomRepository();

  if (await repo.isUserBanned(chatId, userId)) {
    return true;
  }

  if (ip && (await repo.isIpBanned(chatId, ip))) {
    return true;
  }

  return false;
}

export async function handleTypingPacket(ws: ChatWebSocket, content: any) {
  const { chatId, userId } = ws;

  if (!chatId || !userId) {
    console.error(
      "WebSocket is not properly initialized with chatId or userId."
    );
    return;
  }

  const packet = {
    type: "typing",
    content: content,
    sender: userId,
  };

  broadcastToRoom(chatId, packet, ws);
}

export async function handleDisconnectPacket(ws: ChatWebSocket, content: any) {
  const { chatId, userId } = ws;
  const roomRepo = getChatRoomRepository();
  const roomInfo = await roomRepo.getRoomInfo(chatId);
  const isGroupChat =
    roomInfo.max_participants && roomInfo.max_participants > 2;

  if (!isGroupChat) {
    await roomRepo.markClosed(chatId);
  }

  if (isGroupChat) {
    return;
  }

  const packet = {
    type: "disconnect",
    content: null,
    sender: userId,
  };
  broadcastToRoom(chatId, packet, ws);
}

export async function handleUserConnected(ws: ChatWebSocket) {
  const { chatId, userId, ipAddress } = ws;
  if (!ipAddress) {
    return;
  }
  const repo = getChatRoomRepository();
  // auto create room on 1-1 chats
  const roomExists = await repo.roomExists(chatId);
  if (!roomExists) {
    await repo.createRoom(chatId, "1-1 Chat", 2);
  }

  if (await isUserBanned(chatId, userId, ipAddress)) {
    ws.close(BANNED_ROOM_CODE, "You are banned from this room.");
    throw new Error(`User ${userId} is banned from room ${chatId}.`);
  }
  const roomInfo = await repo.getRoomInfo(chatId);
  const maxParticipants = roomInfo.max_participants ?? 2;
  const isGhost = await repo.isGhostMode(chatId, userId);

  const userIds = new Set(
    userStore.getOnlineUsersInRoom(chatId).map((u) => u.id)
  );

  if (!userIds.has(userId) && userIds.size >= maxParticipants && !isGhost) {
    ws.close(ROOM_FULL_CODE, "Room is full.");
    throw new Error(`Room ${chatId} is full.`);
  }

  const existingParticipant = await repo.containsParticipant(chatId, userId);
  if (!existingParticipant) {
    await repo.addParticipant(chatId, userId, generateUserFriendlyName());
  }
  userStore.addUserToRoom(ws, userId, chatId);

  // music

  const existingMusicInfo = await repo.getMusicInfo(chatId);
  if (existingMusicInfo) {
    ws.send(
      JSON.stringify({
        type: "music_sync",
        content: existingMusicInfo,
        sender: "system",
      })
    );

    if (existingMusicInfo?.state === "playing") {
      const currentTime = new Date().getTime();
      const elapsedTime = currentTime - (existingMusicInfo.playTime || 0);

      ws.send(
        JSON.stringify({
          type: "music_play",
          content: {
            currentTime: existingMusicInfo.progress + elapsedTime / 1000,
          },
          sender: "system",
        })
      );
    }
  }

  if (isGhost) {
    return;
  }

  const nickname = (await repo.getNickname(chatId, userId)) || "Someone";

  console.log(
    `User ${userId} connected to room ${chatId} from IP ${ipAddress}. With nickname ${nickname}`
  );

  const message = {
    type: "participant_joined",
    content: { userId, nickname },
    sender: "system",
  };

  broadcastToRoom(chatId, message);
}

export async function handleDisconnect(ws: ChatWebSocket) {
  const { chatId, userId, ipAddress } = ws;
  const repo = getChatRoomRepository();
  const info = await repo.getRoomInfo(chatId);
  const maxParticipants = info.max_participants ?? 2;
  const isGroupChat = maxParticipants > 2;

  userStore.removeUser(ws);

  const stillOnline = userStore
    .getOnlineUsersInRoom(chatId)
    .find((u) => u.id === userId);
  if (!stillOnline) {
    const packet: OfflinePacket = {
      type: "offline",
      content: userId,
      sender: "system",
    };
    broadcastToRoom(chatId, packet, ws);
  }

  // if the room is empty, remove it
  const onlineUsers = userStore.getOnlineUsersInRoom(chatId);
  if (onlineUsers.length === 0 && !isGroupChat) {
    await repo.deleteRoom(chatId);
    console.log(`Room ${chatId} has been removed due to inactivity.`);
  }
}

export async function handleChangeTheme(
  ws: ChatWebSocket,
  content: { mode: "light" | "dark"; theme: ChatThemeV2 }
) {
  const { mode, theme } = content;

  const { chatId, userId } = ws;
  const roomRepo = getChatRoomRepository();

  await roomRepo.setTheme(chatId, theme, mode);

  broadcastToRoom(
    chatId,
    {
      type: "theme_change",
      content: { mode, theme },
      sender: userId,
    },
    ws
  );
}
