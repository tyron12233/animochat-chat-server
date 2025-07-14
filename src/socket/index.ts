import type WebSocket from "ws";
import type { Packet } from "../types";

import * as roomHandler from './handlers/roomHandler';
import type { ChatWebSocket } from "../chat-room";
import { handleChangeNickname, handleDeleteMessage, handleEditMessage, handleReaction, handleSendMessage } from "./handlers/messageHandler";
import { broadcastToRoom } from "./broadcast";
import { handleAddSongRequest, handleMusicFinished, handleMusicPause, handleMusicPlay, handleMusicProgress, handleMusicSet, handleMusicSkipRequest } from "./handlers/musicHandler";

// Define a type for our packet handlers
type PacketHandler = (ws: ChatWebSocket, payload: any) => void;

// Create a registry for packet handlers
const packetHandlers: Record<string, PacketHandler> = {
    'message': handleSendMessage,
    'reaction': handleReaction,
    'message_delete': handleDeleteMessage,
    'edit_message': handleEditMessage,
    'change_nickname': handleChangeNickname,
    'change_theme': roomHandler.handleChangeTheme,
    'disconnect': roomHandler.handleDisconnectPacket,
    'typing': roomHandler.handleTypingPacket,


    // music related
    'music_set': handleMusicSet,
    'music_pause': handleMusicPause,
    'music_play': handleMusicPlay,
    'music_progress': handleMusicProgress,
    'music_skip_request': handleMusicSkipRequest,
    'music_add_queue': handleAddSongRequest,
    'music_finished': handleMusicFinished,
};



export async function onConnection(ws: ChatWebSocket, chatId: string) {
    try {
        await roomHandler.handleUserConnected(ws);
    } catch (error) {
        console.error('Error on connection setup:', error);
        return;
    }


    ws.on('message', (data: Buffer) => {
        try {
            const message: Packet<any, any> = JSON.parse(data.toString());
            const handler = packetHandlers[message.type];

            if (handler) {
                handler(ws, message.content);
            } else {
                console.warn(`No handler found for packet type: ${message.type}`);

                // for unhandled packets, we will just forward them to all participants
                // unsecure for now, but we can improve this later
                broadcastToRoom(ws.chatId, message, ws);
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
    });

    ws.on('close', () => {
        console.log(`👋 Connection closed.`);
        roomHandler.handleDisconnect(ws);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        roomHandler.handleDisconnect(ws);
    });
}