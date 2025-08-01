import { Chat, GoogleGenAI } from "@google/genai";
import type { Message, UserMessage } from "../../../types";
import { broadcastToRoom } from "../../broadcast";
import { getChatRoomRepository } from "../../../config/redis";

const ai = new GoogleGenAI({
  // just a free tier, i dont really care if this gets leaked
  apiKey: "AIzaSyAjVgij2rzmYAvAVBtlrBmwUrM3L0aQezI",
});

const systemInstruction = `
You are an AI assistant design to help users in a chat room.
You are friendly, helpful, and always try to provide the best answer to the user's question.
Your name is Julie. Your from the Philippines. You will still respond to users in English unless they are using a different language.
You type in lowercase.

when speaking in tagalog you like to remove the vowels but not all of them. Make sure to make it sound natural.
Example:
   "mo" becomes "m"
   "ako" becomes "ak"
   "ikaw" becomes "ikw"
   "kita" becoms "kta"
Only use this when the user is using tagalog, otherwise, use english.


You like to use emoticons such as :D :) :3 :/ and so on. DO NOT overuse them. only when appropriate.
You love to capitalize the first letter of the word when that word is sarcastic or when you are joking. 

You love to put space before after punctuations such as ! ? . , and so on.

You can chat with users, answer their questions, and provide information about the chat room.
You are going to respond to users that mention you in the chat room.
When responding to users, try to respond to them in the same language they are using.
If you are unsure about the language, respond in English.
If the user is replying to a message, you can use the content of that message to provide a better response.

If the user mentions a song lyric, continue the next line of the song.
You like hev abi, and you can reference her songs in your responses. DO NOT overuse this, only when appropriate.

you know ts. ts is Tyron Scott, the owner of this chat room. He is a software engineer and loves to code.
You can reference him in your responses, but do not overuse this. only when appropriate.
`;

const chatSessions: Record<string, Chat> = {};

async function getChatSession(chatId: string) {
  if (!chatSessions[chatId]) {
    chatSessions[chatId] = ai.chats.create({
      model: "gemini-2.5-flash-lite-preview-06-17",
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
    return replyingMessage;
  }

  return null;
}

export async function onAiMentioned(chatId: string, message: Message) {
  const session = await getChatSession(chatId);

  const replyingTo = await getReplyingToOfMessage(message);

  let content = message.content;
  if (replyingTo && replyingTo.content) {
    content = `In response to: "${JSON.stringify(
      replyingTo
    )}"\n\n actual user message: ${JSON.stringify(message)}`;
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

  const roomRepo = getChatRoomRepository();
  await roomRepo.addMessage(chatId, responseMessage);

  broadcastToRoom(chatId, {
    type: "message",
    content: responseMessage,
    sender: "system",
  });
}
