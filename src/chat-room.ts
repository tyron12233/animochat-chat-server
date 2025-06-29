import WebSocket from "ws";
import type {
    ChatRoomInfo,
  ChatThemeV2,
  Message,
  OfflinePacket,
  Participant,
  UserJoinedPacket,
} from "./types";

export interface ChatWebSocket extends WebSocket {
  userId: string;
  nickname: string; // Add nickname to the WebSocket interface
}



export class ChatRoom {
  public chatId: string;
  public name: string;
  public maxParticipants: number;
  public theme?: ChatThemeV2;
  public mode: "light" | "dark" = "light";
  public messages: Message[] = [];

  // Map<userId, Participant>
  private participants: Map<string, Participant>;

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
      this.participants.set(ws.userId, {
        userId: ws.userId,
        connections: new Set<ChatWebSocket>(),
        nickname: ws.nickname,
      });
    }

    const participant = this.participants.get(ws.userId)!;
    participant.connections.add(ws);

    // If the nickname has changed, update it
    if (participant.nickname !== ws.nickname) {
        participant.nickname = ws.nickname;
    }


    // Notify other participants that a new user has joined.
    if (!isExistingUser) {
      const packet: UserJoinedPacket = {
        type: "user_joined",
        content: ws.userId,
        sender: "system",
      };
      this.broadcast(ws, JSON.stringify(packet));
    }

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
}