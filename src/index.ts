import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import http from 'http';
import express from 'express';
import { IncomingMessage } from 'http';
import cors from 'cors';

const CHAT_SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

/**
 * An extended WebSocket type that includes chat-specific information.
 * This helps in identifying the user and chat room associated with a connection,
 * especially during disconnection events.
 */
interface ChatWebSocket extends WebSocket {
    userId: string;
    chatId: string;
}

/**
 * This Map stores the chat rooms.
 * The outer key is the 'chatId', a unique identifier for a chat session.
 * The value is another Map where the key is the 'userId' and the value
 * is a Set of all active WebSocket connections for that user in that room.
 *
 * Structure: Map<chatId, Map<userId, Set<ChatWebSocket>>>
 */
const chatRooms = new Map<string, Map<string, Set<ChatWebSocket>>>();

// --- Express App Setup ---
const app = express();
app.use(cors());

/**
 * The status endpoint provides a real-time overview of the chat server's state,
 * including the number of rooms, and for each room, the participants, their user IDs,
 * and the total number of active connections.
 */
app.get('/status', (req, res) => {
    const roomsStatus = {
        totalRooms: chatRooms.size,
        rooms: Array.from(chatRooms.entries()).map(([chatId, roomData]) => {
            // roomData is the Map<userId, Set<ChatWebSocket>>
            const totalConnections = Array.from(roomData.values())
                .reduce((acc, connectionsSet) => acc + connectionsSet.size, 0);

            return {
                chatId,
                participants: roomData.size, // The number of unique users.
                users: Array.from(roomData.keys()), // An array of user IDs in the room.
                totalConnections: totalConnections,
            };
        }),
    };
    res.json(roomsStatus);
});

// Create a standard HTTP server from the Express app.
const server = http.createServer(app);


// --- WebSocket Server Setup ---
const wss = new WebSocketServer({ noServer: true });

// Listen for the 'upgrade' event on the HTTP server to handle WebSocket handshakes.
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    const userId = url.searchParams.get('userId');

    // Basic validation to ensure required parameters are present.
    if (!chatId || !userId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
    }

    // If validation passes, let the WebSocket server handle the upgrade.
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});


/**
 * This is the main connection handler for the WebSocket server.
 * It fires every time a new client establishes a WebSocket connection.
 */
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const chatWs = ws as ChatWebSocket;
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId')!;
    const userId = url.searchParams.get('userId')!;

    console.log(`[${chatId}] User '${userId}' attempting to connect...`);

    // --- Room and User Management ---
    // Get or create the room for the given chatId.
    if (!chatRooms.has(chatId)) {
        chatRooms.set(chatId, new Map<string, Set<ChatWebSocket>>());
    }
    const room = chatRooms.get(chatId)!;
    const isExistingUser = room.has(userId);

    // --- Room Full Check ---
    // A new user cannot join if the room already has 2 unique users.
    // Existing users can always open new connections.
    if (!isExistingUser && room.size >= 2) {
        console.error(`[${chatId}] Connection rejected for new user '${userId}': Room is full with 2 users.`);
        ws.close(1008, 'Chat room is already full with 2 users.');
        return;
    }

    // Assign metadata to the WebSocket object for easy access later.
    chatWs.chatId = chatId;
    chatWs.userId = userId;

    // Get or create the connection set for the user.
    if (!room.has(userId)) {
        room.set(userId, new Set<ChatWebSocket>());
    }
    const userConnections = room.get(userId)!;
    userConnections.add(chatWs);

    const totalConnections = Array.from(room.values()).reduce((acc, connections) => acc + connections.size, 0);
    console.log(`[${chatId}] User '${userId}' connected successfully. Room has ${room.size} user(s) and ${totalConnections} total connection(s).`);

    // --- Notify when the second user joins ---
    // This notification is sent only when a new user joins, making the user count 2.
    if (room.size === 2 && !isExistingUser) {
        console.log(`[${chatId}] Room now has 2 users. Notifying all participants.`);
        const notification = JSON.stringify({ type: 'STATUS', message: 'Your partner has connected. You can now chat!' });
        room.forEach(connectionSet => {
            connectionSet.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(notification);
                }
            });
        });
    }

    // --- Message Handling ---
    ws.on('message', (message: Buffer) => {
        // Broadcast the message to every other client in the same room.
        room.forEach((connectionSet) => {
            connectionSet.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(message.toString()); // Ensure message is sent as string
                }
            });
        });
    });

    // --- Disconnection Handling ---
    ws.on('close', () => {
        // We retrieve the metadata we stored on the WebSocket object.
        console.log(`[${chatWs.chatId}] A connection for user '${chatWs.userId}' disconnected.`);
        
        // The room might have been already closed, so we check for its existence.
        const room = chatRooms.get(chatWs.chatId);
        if (!room) return;

        const userConnections = room.get(chatWs.userId);
        if (!userConnections) return;

        // Remove the specific connection that was closed.
        userConnections.delete(chatWs);

        // If the user has no more active connections, they are removed from the room.
        if (userConnections.size === 0) {
            console.log(`[${chatWs.chatId}] User '${chatWs.userId}' has no more connections and is removed from the room.`);
            room.delete(chatWs.userId);

            // Notify the remaining participants that a user has gone offline.
            const notification = JSON.stringify({ type: 'STATUS', message: `User ${chatWs.userId} has gone offline.` });
            room.forEach(connectionSet => {
                connectionSet.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(notification);
                    }
                });
            });
        }
        
        // If the room becomes empty of users, we clean it up.
        if (room.size === 0) {
            console.log(`[${chatWs.chatId}] Room is now empty and has been closed.`);
            chatRooms.delete(chatWs.chatId);
        }
    });

    // --- Error Handling ---
    ws.on('error', (error) => {
        console.error(`[${chatWs.chatId}] An error occurred for user '${chatWs.userId}':`, error);
    });
});

// --- Server Start ---
server.listen(CHAT_SERVER_PORT, () => {
    console.log(`Express and WebSocket Server is running on port ${CHAT_SERVER_PORT}`);
    console.log(`WebSocket connections at ws://localhost:${CHAT_SERVER_PORT}`);
    console.log(`Check status at http://localhost:${CHAT_SERVER_PORT}/status`);
});
