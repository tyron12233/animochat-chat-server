import WebSocket from "ws";
import type { ChatThemeV2, OfflinePacket } from "./types";

export interface ChatWebSocket extends WebSocket {
    userId: string;
}

export class ChatRoom {

    public chatId: string;
    public theme?: ChatThemeV2;
    public mode: 'light' | 'dark' = 'light';
    // Map<userId, Set<WebSocketConnections>>
    private participants: Map<string, Set<WebSocket>>;

     constructor(chatId: string) {
        this.chatId = chatId;
        this.participants = new Map<string, Set<WebSocket>>();
        console.log(`[${chatId}] ChatRoom created.`);
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
            throw new Error('Chat room is already full with 2 users.');
        }

        if (!this.participants.has(ws.userId)) {
            this.participants.set(ws.userId, new Set<ChatWebSocket>());
        }
        this.participants.get(ws.userId)!.add(ws);

        return { isNewUser: !isExistingUser, userCount: this.getParticipantCount() };
    }

     /**
     * Removes a WebSocket connection from the room. If the user has no more
     * connections, they are removed from the participants list, and an
     * 'offline' packet is broadcast to the remaining user.
     * @param ws The ChatWebSocket instance to remove.
     */
    removeUser(ws: ChatWebSocket): void {
        const userConnections = this.participants.get(ws.userId);
        if (!userConnections) return;

        userConnections.delete(ws);

        if (userConnections.size === 0) {
            console.log(`[${this.chatId}] User '${ws.userId}' has no more connections and is removed from the room.`);
            this.participants.delete(ws.userId);

            // Notify remaining participants that a user has gone offline.
            const packet: OfflinePacket = {
                type: 'offline',
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
        this.participants.forEach((connectionSet) => {
            connectionSet.forEach(client => {
                // Check if it's not the sender and the connection is open
                if (client !== senderWs && client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });
        });
    }

    /**
     * Broadcasts a message to every single client in the room.
     * @param message The message to broadcast.
     */
    broadcastToAll(message: string): void {
        this.participants.forEach(connectionSet => {
            connectionSet.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });
        });
    }

      /**
     * Sets the shared theme for the chat room.
     * @param theme The theme object.
     */
    setTheme(theme: ChatThemeV2) {
        this.theme = theme;
    }

    setMode(mode: 'light' | 'dark') {
        this.mode = mode;
    }

    /** Checks if the room has reached its maximum capacity of unique users. */
    isFull(): boolean {
        return this.participants.size >= 2;
    }

    /** Checks if the room has any participants left. */
    isEmpty(): boolean {
        return this.participants.size === 0;
    }

    /** Returns the number of unique users in the room. */
    getParticipantCount(): number {
        return this.participants.size;
    }

    /** Returns the total number of active WebSocket connections in the room. */
    getTotalConnectionCount(): number {
        return Array.from(this.participants.values())
            .reduce((acc, connectionsSet) => acc + connectionsSet.size, 0);
    }
}