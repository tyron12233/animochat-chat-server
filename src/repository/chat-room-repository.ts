import type { ChatRoomInfo, ChatThemeV2, Message, PublicRoomInfo, Reaction } from "../types";

export interface IChatRoomRepository {
  // --- Room Management ---
  markClosed(chatId: string): Promise<any>;
  isRoomClosed(chatId: string): Promise<boolean>;
  createRoom(chatId: string, name: string, maxParticipants: number): Promise<any>;
  deleteRoom(chatId: string): Promise<any>;
  roomExists(chatId: string): Promise<boolean>;
  listPublicRooms(): Promise<PublicRoomInfo[]>;
  makeRoomPublic(chatId: string): Promise<any>;
  getRoomInfo(chatId: string): Promise<Partial<ChatRoomInfo>>;
  getAllRoomIds(): Promise<string[]>;

  // --- Message Management ---
  updateReaction(chatId: string, reaction: Reaction): Promise<boolean>;
  markMessageAsDeleted(chatId: string, messageId: string): Promise<boolean>;
  editMessage(chatId: string, messageId: string, newContent: string): Promise<boolean>;
  addMessage(chatId: string, message: Message): Promise<any>;
  getMessages(chatId: string, start: number, end: number): Promise<Message[]>;
  getMessageCount(chatId: string): Promise<number>;

  // --- Participant & Nickname Management ---
  addParticipant(chatId: string, userId: string, initialNickname: string): Promise<any>;
  removeParticipant(chatId: string, userId: string): Promise<any>;
  getParticipantIds(chatId: string): Promise<string[]>;
  getParticipantCount(chatId: string): Promise<number>;

  getNicknames(chatId: string): Promise<Map<string, string>>;
  getNickname(chatId: string, userId: string): Promise<string | null>;
  setNickname(chatId: string, userId: string, newNickname: string): Promise<any>;

  // --- Ghost Mode ---
  setGhostMode(chatId: string, userId: string, isGhost: boolean): Promise<any>;
  isGhostMode(chatId: string, userId: string): Promise<boolean>;
  getAllGhosts(chatId: string): Promise<string[]>;

  // --- Ban Management ---
  banUser(chatId: string, userId: string): Promise<any>;
  isUserBanned(chatId: string, userId: string): Promise<boolean>;
  banIp(chatId: string, ip: string): Promise<any>;
  isIpBanned(chatId: string, ip: string): Promise<boolean>;

  // --- Theme Management ---
  setTheme(chatId: string, theme: ChatThemeV2, mode: "light" | "dark"): Promise<any>;
  getTheme(chatId: string): Promise<{ theme: ChatThemeV2 | null; mode: "light" | "dark" }>;
}
