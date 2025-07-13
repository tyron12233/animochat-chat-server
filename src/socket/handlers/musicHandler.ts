import type { ChatWebSocket } from "../../chat-room";
import { getChatRoomRepository } from "../../config/redis";
import { broadcastToRoom } from "../broadcast";

/**
 * Represents the structure of a song object.
 */
interface Song {
  name: string;
  url: string;
}

/**
 * Represents the data received from the 'music_play' WebSocket event.
 */
interface MusicPlayPayload {
  currentTime: number;
}

/**
 * Represents the data received from the 'music_seek' WebSocket event.
 */
interface MusicSeekPayload {
  seekTime: number;
}

export async function handleMusicProgress(
  ws: ChatWebSocket,
  payload: { progress: number }
) {
  const repo = getChatRoomRepository();

  const current = await repo.getMusicInfo(ws.chatId);

  if (!current) return;

  const msg = {
    ...current,
    progress: payload.progress,
  };

  repo.setMusicInfo(ws.chatId, msg);
}

export async function handleMusicSet(ws: ChatWebSocket, payload: Song) {
  // Handle the 'music_set' event
  console.log(`Setting music for chat ${ws.chatId}:`, payload);

  const repo = getChatRoomRepository();
  const existingMusicInfo = await repo.getMusicInfo(ws.chatId);

  if (existingMusicInfo) {
    broadcastToRoom(ws.chatId, {
      type: "music_pause",
      content: null,
      sender: ws.userId,
    });
  }

  await repo.setMusicInfo(ws.chatId, {
    name: payload.name,
    url: payload.url,
    progress: 0,
    state: "paused",
  });

  broadcastToRoom(ws.chatId, {
    type: "music_set",
    content: payload,
    sender: ws.userId,
  });
}

export async function handleMusicPlay(
  ws: ChatWebSocket,
  payload: MusicPlayPayload
) {
  const repo = getChatRoomRepository();

  repo.updateMusicInfo(ws.chatId, {
    state: "playing",
    progress: payload.currentTime,
    playTime: Date.now(),
  });

  broadcastToRoom(ws.chatId, {
    type: "music_play",
    content: payload,
    sender: ws.userId,
  });
}

export function handleMusicPause(ws: ChatWebSocket, payload: any) {
  const repo = getChatRoomRepository();
  repo.updateMusicInfo(ws.chatId, {
    state: "paused",
  });

  broadcastToRoom(ws.chatId, {
    type: "music_pause",
    content: null,
    sender: ws.userId,
  });
}

export type { MusicPlayPayload, MusicSeekPayload, Song };
