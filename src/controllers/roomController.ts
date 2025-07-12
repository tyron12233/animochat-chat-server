import type { Request, Response } from "express";
import { getChatRoomRepository } from "../config/redis";

import * as userStore from "../userStore";
import type { Message, MessagesSyncPacket } from "../types";

/**
 * @description Get all chat rooms
 * @route GET /rooms
 */
export async function getRooms(req: Request, res: Response) {
  const roomRepo = getChatRoomRepository();

  const publicRooms = await roomRepo.listPublicRooms();
  const roomsWithOnlineCount = publicRooms.map(async (room) => {
    const onlineCount = userStore.getOnlineUsersInRoom(room.id);
    const recentMessage = await roomRepo.getMessages(room.id, 0, 1);

    return {
      id: room.id,
      name: room.name,
      max_participants: room.max_participants,
      participants: onlineCount,
      recent_message: recentMessage[0],
    };
  });

  const result = await Promise.all(roomsWithOnlineCount);
  res.json(result);
}

/**
 * @description Synchronize chat room messages and participants
 * @route GET /sync/:chatId
 * @param {string} chatId - The ID of the chat room to synchronize
 */
export async function syncChatRoom(req: Request, res: Response) {
  const { chatId } = req.params;

  const roomRepo = getChatRoomRepository();

  if (!chatId || !(await roomRepo.roomExists(chatId))) {
    res.status(404).json({ error: "Chat room not found" });
    return;
  }

  // Fetch the latest 50 messages to display on screen
  const messagesToDisplay = 100;
  let messages = await roomRepo.getMessages(chatId, 0, messagesToDisplay - 1);

  // Check the total number of persisted messages
  const totalMessageCount = await roomRepo.getMessageCount(chatId);

  // If the total message count is greater than the number we are displaying,
  // it means the history is truncated.
  if (totalMessageCount >= messagesToDisplay) {
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

  let nickanmeMap: Map<string, string> = new Map();

  // for each of the messages, we add senderNickname property to it
  messages = await Promise.all(
    messages.map(async (message) => {
      if (message.sender && message.sender !== "system") {
        if (!nickanmeMap.has(message.sender)) {
          const nickname = await roomRepo.getNickname(chatId, message.sender);
          nickanmeMap.set(message.sender, nickname || "[Unknown]");
        }
        return {
          ...message,
          senderNickname: nickanmeMap.get(message.sender) || "[Unknown]",
        };
      } else {
        return {
          ...message,
        };
      }
    })
  );

  const messagesSyncPacket: MessagesSyncPacket = {
    type: "messages_sync",
    sender: "system",
    content: messages,
  };

  const themeInfo = await roomRepo.getTheme(chatId);

  // online participants
  const onlineParticipants = userStore.getOnlineUsersInRoom(chatId);

  const ghosts = await roomRepo.getAllGhosts(chatId);
  // Filter out ghosts from online participants
  const onlineParticipantsWithoutGhosts = onlineParticipants.filter(
    (a) => !ghosts.includes(a.id)
  );

  const onlineParticipantsWithNicknames = await Promise.all(
    onlineParticipantsWithoutGhosts.map(async (user) => {
      let nickname = nickanmeMap.get(user.id);
      if (!nickname) {
        nickname = (await roomRepo.getNickname(chatId, user.id)) ?? "Unknown";
      }

      const userId = user.id;
      return {
        userId,
        nickname,
        status: "online",
      };
    })
  );

  res.json({
    theme: themeInfo.theme || null,
    mode: themeInfo.mode || "light",
    messages: messagesSyncPacket,
    onlineParticipants: onlineParticipantsWithNicknames,
  });
}

export async function deleteRoom(req: Request, res: Response) {
  const roomRepo = getChatRoomRepository();
  if ((req as any).user.role !== "admin") {
    res.status(403).json({ error: "Only admins can delete rooms" });
    return;
  }

  const { chatId } = req.body;
  if (!chatId) {
    res.status(400).json({ error: "Chat ID is required" });
    return;
  }

  if (!(await roomRepo.roomExists(chatId))) {
    res.status(404).json({ error: "Chat room not found" });
    return;
  }

  await roomRepo.deleteRoom(chatId);

  // Remove all ghosts from the room
  userStore.deleteRoom(chatId);

  res.status(200).json({ message: "Chat room deleted successfully" });
}

export async function ghostMode(req: Request, res: Response) {
  const roomRepo = getChatRoomRepository();

  if ((req as any).user.role !== "admin") {
    res.status(403).json({ error: "Only admins can enable ghost mode" });
    return;
  }

  const { chatId, enable } = req.body;
  if (!chatId || typeof enable !== "boolean") {
    res.status(400).json({ error: "Chat ID and enable flag are required" });
    return;
  }

  if (!(await roomRepo.roomExists(chatId))) {
    res.status(404).json({ error: "Chat room not found" });
    return;
  }

  const userId = (req as any).user.id;

  await roomRepo.setGhostMode(chatId, userId, enable);

  res.status(200).json({
    message: `Ghost mode ${
      enable ? "enabled" : "disabled"
    } for user ${userId} in room ${chatId}`,
  });
}

export async function createRoom(req: Request, res: Response) {
  const roomRepo = getChatRoomRepository();

  if ((req as any)?.user?.role !== "admin") {
    res.status(403).json({ error: "Only admins can create rooms for now :p" });
    return;
  }

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
}
