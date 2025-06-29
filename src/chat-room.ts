import WebSocket from "ws";
import type {
  ChangeNicknamePacket,
    ChatRoomInfo,
  ChatThemeV2,
  Message,
  OfflinePacket,
  Participant,
  ParticipantJoinedPacket,
  SystemMessage,
  UserJoinedPacket,
} from "./types";
import { generateUserFriendlyName } from "./util";

export interface ChatWebSocket extends WebSocket {
  userId: string;
}


export class ChatRoom {
  public chatId: string;
  public name: string;
  public maxParticipants: number;
  public theme?: ChatThemeV2;
  public mode: "light" | "dark" = "light";
  public messages: Message[] = [];
  public bannedUsers: Set<string> = new Set<string>();
  public bannedIps: Set<string> = new Set<string>();
  
  // user id to nickanme mapping
  public nicknames: Map<string, string> = new Map<string, string>();

  // Map<userId, Participant>
  public participants: Map<string, Participant>;

  constructor(chatId: string, name: string, maxParticipants: number = 2) {
    this.chatId = chatId;
    this.name = name;
    this.maxParticipants = maxParticipants;
    this.participants = new Map<string, Participant>();
  }

  /**
   * Adds a new WebSocket connection to the room for a specific user.
   * @param ws The ChatWebSocket instance to add.
   * @returns A status object indicating if a new user joined and the total user count.
   * @throws An error if a new user tries to join a full room.
   */
  addUser(ws: ChatWebSocket): { isNewUser: boolean; userCount: number } {
    const isExistingUser = this.participants.has(ws.userId);

    if (!isExistingUser && this.isFull()) {
      throw new Error(`Chat room '${this.name}' is already full.`);
    }

    if (!isExistingUser) {
      
      // Generate a user-friendly name if the user doesn't have one
      let name = this.nicknames.get(ws.userId);
      if (!name) {
        name = generateUserFriendlyName();
        // Ensure the name is unique by checking against existing nicknames
        while (this.nicknames.has(name)) {
          name = generateUserFriendlyName();
        }
        this.nicknames.set(ws.userId, name);
      }

      this.participants.set(ws.userId, {
        userId: ws.userId,
        connections: new Set<ChatWebSocket>(),
        nickname: name
      });
    }

    const participant = this.participants.get(ws.userId)!;
    participant.connections.add(ws);

    return {
      isNewUser: !isExistingUser,
      userCount: this.getParticipantCount(),
    };
  }

  /**
   * Removes a WebSocket connection from the room. If the user has no more
   * connections, they are removed from the participants list, and an
   * 'offline' packet is broadcast to the remaining user.
   * @param ws The ChatWebSocket instance to remove.
   */
  removeUser(ws: ChatWebSocket): void {
    const participant = this.participants.get(ws.userId);
    if (!participant) return;

    participant.connections.delete(ws);

    if (participant.connections.size === 0) {
      console.log(
        `[${this.chatId}] User '${ws.userId}' (${participant.nickname}) has no more connections and is removed from the room.`
      );
      this.participants.delete(ws.userId);

      // Notify remaining participants that a user has gone offline.
      const packet: OfflinePacket = {
        type: "offline",
        content: ws.userId,
        sender: ws.userId,
      };
      this.broadcastToAll(JSON.stringify(packet));
    }
  }

  /**
   * Broadcasts a message to all participants in the room except the sender.
   * @param senderWs The WebSocket of the message sender.
   * @param message The message to broadcast.
   */
  broadcast(senderWs: ChatWebSocket, message: string): void {
    this.participants.forEach((participant, userId) => {
      // We don't broadcast to the sender's own connections
      if (userId === senderWs.userId) {
        return;
      }
      participant.connections.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    });
  }

  /**
   * Broadcasts a message to every single client in the room, including the sender.
   * @param message The message to broadcast.
   */
  broadcastToAll(message: string): void {
    this.participants.forEach((participant) => {
      participant.connections.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    });
  }

  /** Sets the shared theme for the chat room. */
  setTheme(theme: ChatThemeV2) {
    this.theme = theme;
  }

  /** Sets the shared mode for the chat room. */
  setMode(mode: "light" | "dark") {
    this.mode = mode;
  }

  /** Checks if the room has reached its maximum capacity of unique users. */
  isFull(): boolean {
    return this.participants.size >= this.maxParticipants;
  }

  /** Checks if the room has any participants left. */
  isEmpty(): boolean {
    return this.participants.size === 0;
  }

  /** Returns the number of unique users in the room. */
  getParticipantCount(): number {
    return this.participants.size;
  }

  /** Returns an array of the user IDs of all participants. */
  getParticipantIds(): string[] {
    return Array.from(this.participants.keys());
  }

  /** Returns a map of participant user IDs to their nicknames. */
  getParticipantNicknames(): Map<string, string> {
    const nicknames = new Map<string, string>();
    this.participants.forEach((participant, userId) => {
        nicknames.set(userId, participant.nickname);
    });
    return nicknames;
  }


  /** Returns the total number of active WebSocket connections in the room. */
  getTotalConnectionCount(): number {
    return Array.from(this.participants.values()).reduce(
      (acc, participant) => acc + participant.connections.size,
      0
    );
  }

  /** Returns the public-facing information for the chat room. */
  getInfo(): ChatRoomInfo {
    const participantsInfo = Array.from(this.participants.entries()).map(([userId, participant]) => ({
        userId,
        nickname: participant.nickname
    }));

    return {
      id: this.chatId,
      name: this.name,
      participants: participantsInfo,
      max_participants: this.maxParticipants,
    };
  }

  changeNickname(userId: string, newNickname: string): void {
    const oldNickname = this.nicknames.get(userId);

    // Ensure the new nickname is unique
    if (this.nicknames.has(newNickname)) {
      // append a number to the new nickname if it already exists
      let counter = 1;
      let uniqueNickname = `${newNickname}${counter}`;
      while (this.nicknames.has(uniqueNickname)) {
        counter++;
        uniqueNickname = `${newNickname}${counter}`;
      }
    }

    this.nicknames.set(userId, newNickname);

    let message = `A user changed their nickname to ${newNickname}.`;
    if (oldNickname) {
      message = `${oldNickname} changed their nickname to ${newNickname}.`;
    }


    const systemMessage: SystemMessage = {
      type: "system",
      content: message,
      created_at: new Date().toISOString(),
      id: "system_" + new Date().toISOString(),
      sender: "system",
      session_id: this.chatId,
    }
    const notification = JSON.stringify({
        type: "STATUS",
        message: message,
      });
    this.messages.push(systemMessage);
    this.broadcastToAll(notification);

    
    const packet: ChangeNicknamePacket = {
      type: "change_nickname",
      content: {
        userId,
        newNickname,
      },
      sender: userId,
    }
    this.broadcastToAll(JSON.stringify(packet));
  }
}