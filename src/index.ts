import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { IncomingMessage } from 'http';

const CHAT_SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

/**
 * This Map stores the chat rooms.
 * The key is the 'chatId', a unique identifier for a chat session between two users.
 * The value is a Set of WebSocket connections for the users in that chat room.
 * A Set is used because it simplifies adding/removing connections and ensures no duplicates.
 */
const chatRooms = new Map<string, Set<WebSocket>>();

// Create a new WebSocket server instance.
const wss = new WebSocketServer({ port: CHAT_SERVER_PORT });

/**
 * This is the main connection handler for the WebSocket server.
 * It fires every time a new client attempts to establish a WebSocket connection.
 */
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // The initial HTTP request ('req') is used to get connection parameters.
    // We expect the client to provide 'userId' and 'chatId' in the URL.
    // e.g., ws://localhost:8080?userId=user-abc&chatId=interest-xyz-123
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    const userId = url.searchParams.get('userId');

    if (!chatId || !userId) {
        console.error('Connection rejected: chatId and userId parameters are required.');
        // Close the connection with a specific error code and reason.
        ws.close(1008, 'Chat ID and User ID are required.');
        return;
    }

    console.log(`[${chatId}] User '${userId}' attempting to connect...`);

    // --- Room Management ---
    // If a room for this chatId doesn't exist, create one.
    if (!chatRooms.has(chatId)) {
        chatRooms.set(chatId, new Set<WebSocket>());
    }

    const room = chatRooms.get(chatId)!;

    // Reject connections if the room is already full (i.e., has 2 participants).
    if (room.size >= 2) {
        console.error(`[${chatId}] Connection rejected for '${userId}': Room is full.`);
        ws.close(1008, 'Chat room is already full.');
        return;
    }

    // Add the new user's WebSocket connection to the room.
    room.add(ws);
    console.log(`[${chatId}] User '${userId}' connected successfully. Room size: ${room.size}.`);
    
    // If the room is now full, notify both users that their partner has connected.
    if(room.size === 2) {
        console.log(`[${chatId}] Room is now full. Notifying participants.`);
        const notification = JSON.stringify({ type: 'STATUS', message: 'Your partner has connected. You can now chat!' });
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(notification);
            }
        });
    }


    // --- Message Handling ---
    // Set up a listener for messages coming from this specific client.
    ws.on('message', (message: Buffer) => {
        // We use a Buffer to handle binary data, but convert to string for logging.
        console.log(`[${chatId}] Received message from '${userId}': ${message.toString()}`);

        // Relay the message to the other client in the room.
        room.forEach(client => {
            // Check if the client is not the sender and the connection is still open.
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    // --- Disconnection Handling ---
    // Set up a listener for when this client's connection closes.
    ws.on('close', () => {
        console.log(`[${chatId}] User '${userId}' disconnected.`);
        
        // Remove the user from the room.
        room.delete(ws);
        
        // Notify the remaining user (if any) that their partner has left.
        const notification = JSON.stringify({ type: 'STATUS', message: 'Your partner has disconnected.' });
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(notification);
            }
        });

        // If the room is now empty, delete it from the map to clean up memory.
        if (room.size === 0) {
            console.log(`[${chatId}] Room is now empty and has been closed.`);
            chatRooms.delete(chatId);
        }
    });

    // --- Error Handling ---
    ws.on('error', (error) => {
        console.error(`[${chatId}] An error occurred for user '${userId}':`, error);
    });
});

console.log(`WebSocket Chat Server is running on ws://localhost:${CHAT_SERVER_PORT}`);