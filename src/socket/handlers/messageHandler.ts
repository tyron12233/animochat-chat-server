import type { ChatWebSocket } from "../../chat-room";
import { getChatRoomRepository } from "../../config/redis";
import type {
  Message,
  MessageAcknowledgmentPacket,
  MessagePacket,
  Reaction,
  SystemMessage,
} from "../../types";
import { broadcastToRoom } from "../broadcast";

const nonText = ["image", "voice_message"];
const textMessages = ["user", "text"];

function isTextMessage(type: string) {
  return textMessages.includes(type) && !nonText.includes(type);
}

export async function handleSendMessage(ws: ChatWebSocket, message: Message) {
  const { chatId, userId } = ws;

  if (!chatId || !userId) {
    console.error(
      "WebSocket is not properly initialized with chatId or userId."
    );
    return;
  }

  const roomRepo = getChatRoomRepository();

  let content = message.content;
  if (isTextMessage(message.type ?? "text")) {
    content = content?.slice(0, 700);
  }
  let newMessage: Message = {
    ...message,
    content,
    senderNickname: message.senderNickname ?? (await roomRepo.getNickname(chatId, userId) ?? "Anonymous"),
  };

  await roomRepo.addMessage(chatId, newMessage);

  // send acknowledgment to the sender
  ws.send(
    JSON.stringify({
      type: "message_acknowledgment",
      content: {
        messageId: newMessage.id,
        sender: "system",
      },
    } as MessageAcknowledgmentPacket)
  );

  const packet: MessagePacket = {
    type: "message",
    content: newMessage,
    sender: userId,
  };

  broadcastToRoom(chatId, packet, ws);
}

export async function handleReaction(ws: ChatWebSocket, reaction: Reaction) {
  const { chatId, userId } = ws;

  const roomRepo = getChatRoomRepository();

  await roomRepo.updateReaction(chatId, reaction);

  const anyReaction: any = reaction;
  if (anyReaction.nickname === undefined || anyReaction.nickname === null) {
    anyReaction.nickname = await roomRepo.getNickname(chatId, userId);
  }

  broadcastToRoom(
    chatId,
    {
      type: "reaction",
      content: anyReaction,
      sender: userId,
    },
    ws
  );
}

export async function handleDeleteMessage(
  ws: ChatWebSocket,
  messageId: string
) {
  const { chatId, userId } = ws;

  const roomRepo = getChatRoomRepository();

  await roomRepo.markMessageAsDeleted(chatId, messageId);

  broadcastToRoom(
    chatId,
    {
      type: "message_delete",
      content: messageId,
      sender: userId,
    },
    ws
  );
}

export async function handleEditMessage(
  ws: ChatWebSocket,
  content: { message_id: string; new_content: string }
) {
  const { chatId, userId } = ws;

  const roomRepo = getChatRoomRepository();

  await roomRepo.editMessage(chatId, content.message_id, content.new_content);

  broadcastToRoom(
    chatId,
    {
      type: "edit_message",
      content: {
        message_id: content.message_id,
        new_content: content.new_content,
      },
      sender: userId,
    },
    ws
  );
}

export async function handleChangeNickname(
  ws: ChatWebSocket,
  content: { newNickname: string }
) {
  const { chatId, userId } = ws;
  const roomRepo = getChatRoomRepository();
  let { newNickname } = content;
  const oldNickname = await roomRepo.getNickname(chatId, userId);
  if (newNickname === oldNickname) {
    // No change in nickname, just return
    return;
  }

  if (newNickname.length > 20) {
    newNickname = newNickname.slice(0, 20);
  }

  await roomRepo.setNickname(chatId, userId, newNickname);

  const systemMessage: SystemMessage = {
    type: "system",
    content: `${oldNickname} is now known as ${newNickname}`,
    sender: "system",
    created_at: new Date().toISOString(),
    session_id: chatId,
    id: `nickname-change-${Date.now()}`,
  };
  broadcastToRoom(chatId, {
    type: "message",
    content: systemMessage,
    sender: "system",
  } as MessagePacket);

  broadcastToRoom(chatId, {
    type: "change_nickname",
    content: {
      userId,
      newNickname,
    },
    sender: userId,
  });
}
