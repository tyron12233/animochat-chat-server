import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import http from 'http';
import express from 'express'; // Import express
import { IncomingMessage } from 'http';
import cors from 'cors'; 

const CHAT_SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

/**
 * This Map stores the chat rooms.
 * The key is the 'chatId', a unique identifier for a chat session.
 * The value is a Set of WebSocket connections for the users in that chat room.
 */
const chatRooms = new Map<string, Set<WebSocket>>();

// --- Express App Setup ---
const app = express();

app.use(cors());

// This is our new status endpoint using Express.
app.get('/status', (req, res) => {
    // Prepare the status data.
    const roomsStatus = {
        totalRooms: chatRooms.size,
        rooms: Array.from(chatRooms.entries()).map(([chatId, connections]) => ({
            chatId,
            participants: connections.size,
        })),
    };

    // Send the status data as a JSON response using Express's json method.
    res.json(roomsStatus);
});

// Create a standard HTTP server from the Express app.
// This allows us to share the same server for both Express routes and WebSocket connections.
const server = http.createServer(app);


// --- WebSocket Server Setup ---
// Create a new WebSocket server instance without a dedicated port.
// It will be integrated with our existing HTTP server.
const wss = new WebSocketServer({ noServer: true });

// Listen for the 'upgrade' event on the HTTP server.
// This is where an HTTP connection is "upgraded" to a WebSocket connection.
server.on('upgrade', (request, socket, head) => {
    // The original request URL is needed to extract chatId and userId.
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    const userId = url.searchParams.get('userId');

    // Basic validation before upgrading.
    if (!chatId || !userId) {
        // If validation fails, destroy the socket to prevent the connection.
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
    }

    // If validation passes, let the WebSocket server handle the handshake.
    wss.handleUpgrade(request, socket, head, (ws) => {
        // The 'connection' event is then emitted for the successfully upgraded WebSocket.
        wss.emit('connection', ws, request);
    });
});


/**
 * This is the main connection handler for the WebSocket server.
 * It fires every time a new client establishes a WebSocket connection.
 */
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // The initial HTTP request ('req') is used to get connection parameters.
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId')!; // We know these exist from the 'upgrade' check
    const userId = url.searchParams.get('userId')!;

    console.log(`[${chatId}] User '${userId}' attempting to connect...`);

    // --- Room Management ---
    if (!chatRooms.has(chatId)) {
        chatRooms.set(chatId, new Set<WebSocket>());
    }

    const room = chatRooms.get(chatId)!;

    if (room.size >= 2) {
        console.error(`[${chatId}] Connection rejected for '${userId}': Room is full.`);
        ws.close(1008, 'Chat room is already full.');
        return;
    }

    room.add(ws);
    console.log(`[${chatId}] User '${userId}' connected successfully. Room size: ${room.size}.`);
    
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
    ws.on('message', (message: Buffer) => {
        room.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    // --- Disconnection Handling ---
    ws.on('close', () => {
        console.log(`[${chatId}] User '${userId}' disconnected.`);
        room.delete(ws);
        
        const notification = JSON.stringify({ type: 'STATUS', message: 'Your partner has went offline.' });

        // notify remaininf participants
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(notification);
            }
        });

        if (room.size === 0) {
            // closing the room for now, but in the future we should consider keeping it open for a while to allow reconnections.
            console.log(`[${chatId}] Room is now empty and has been closed.`);
            chatRooms.delete(chatId);
        }
    });

    // --- Error Handling ---
    ws.on('error', (error) => {
        console.error(`[${chatId}] An error occurred for user '${userId}':`, error);
    });
});



server.listen(CHAT_SERVER_PORT, () => {
    console.log(`Express and WebSocket Server is running on port ${CHAT_SERVER_PORT}`);
    console.log(`WebSocket connections at ws://localhost:${CHAT_SERVER_PORT}`);
    console.log(`Check status at http://localhost:${CHAT_SERVER_PORT}/status`);
});
