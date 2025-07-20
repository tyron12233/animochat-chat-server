import { Chat, GoogleGenAI } from "@google/genai";
import type { Message, UserMessage } from "../../../types";
import { broadcastToRoom } from "../../broadcast";
import { getChatRoomRepository } from "../../../config/redis";

const ai = new GoogleGenAI({
  // just a free tier, i dont really care if this gets leaked
  apiKey: "AIzaSyAjVgij2rzmYAvAVBtlrBmwUrM3L0aQezI",
});

const systemInstruction = `
You are a helpful AI Assistant for AnimoChat, an anonymous chat platform made by lasallians.
Your name is Julie.
You are designed to assist users in the chat by providing helpful responses and engaging in conversations.
You should always respond in a friendly and helpful manner.
You should not reveal any personal information about yourself or the platform.
You should not engage in any harmful or inappropriate conversations.
You should always prioritize the safety and well-being of the users.
You should always follow the guidelines and policies of AnimoChat.
You should always be respectful and considerate of the users.
You should always strive to provide accurate and helpful information.
You should always be aware of the context of the conversation and respond accordingly.
You should always be aware of the user's intent and respond accordingly.
You should always be aware of the user's emotions and respond accordingly.
You should always be aware of the user's preferences and respond accordingly.
You should always be aware of the user's language and respond accordingly.

You should reply in paragraph format unless the user asks for a list or bullet points.
`;

const chatSessions: Record<string, Chat> = {};

async function getChatSession(chatId: string) {
  if (!chatSessions[chatId]) {
    chatSessions[chatId] = ai.chats.create({
      model: "gemini-1.5-flash",
      config: {
        systemInstruction,
      },
    });
  }
  return chatSessions[chatId];
}

async function getReplyingToOfMessage(message: any): Promise<Message | null> {
    // if message.replyingTo is an object, return the object
    if (typeof message.replyingTo === "object") {
        return message.replyingTo as Message;
    }

    // if its a string, retrieve the message from the chat room repository
    if (typeof message.replyingTo === "string") {
        const repo = getChatRoomRepository();
        const chatId = message.session_id;
        const replyingMessage = await repo.getMessage(chatId, message.replyingTo);
        return replyingMessage ;
    }

    return null;
}

export async function onAiMentioned(chatId: string, message: Message) {
  const session = await getChatSession(chatId);

  const replyingTo = await getReplyingToOfMessage(message);

  let content = message.content;
  if (replyingTo) {
    content = `In response to: "${replyingTo.content}"\n\n${content}`;
  }

  const response = await session.sendMessage({
    message: content,
  });

  if (!response.text) {
    console.error("AI response is empty or undefined");
    return;
  }

  

  const responseMessage: UserMessage = {
    content: response.text,
    sender: "julie-ai",
    created_at: new Date().toISOString(),
    id: `julie-ai-${Date.now()}`,
    replyingTo: message.id,
    senderNickname: "Julie AI",
    session_id: chatId,
  };
  broadcastToRoom(chatId, {
    type: "message",
    content: responseMessage,
    sender: "system",
  });
}
