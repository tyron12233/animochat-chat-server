import type { ChatWebSocket } from "../../chat-room";
import { getChatRoomRepository } from "../../config/redis";
import { broadcastToRoom, sendSystemMessage } from "../broadcast";
import * as userStore from "../../userStore";
import type { Packet } from "../../types";

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

export async function handleMusicFinished(ws: ChatWebSocket, payload: any) {
  const repo = getChatRoomRepository();

  const current = await repo.getMusicInfo(ws.chatId);
  if (!current) return;

  // if most of the participants are finished, we will play the next song
  const onlineUsers = userStore.getOnlineUsersInRoom(ws.chatId);
  const finishedUsers = current.finishedUsers || [];

  const finishedSet = new Set(finishedUsers);
  finishedSet.add(ws.userId);

  const finishedCount = finishedSet.size;
  const requiredCount = Math.ceil(onlineUsers.length / 2);
  const hasEnoughFinished = finishedCount >= requiredCount;

  if (hasEnoughFinished) {
    // play the next song
    const nextSong = current.queue?.shift();
    if (nextSong) {
        sendSystemMessage(
            ws.chatId,
            `Now playing: ${nextSong.name}`
        )

      // Set the next song as the current song
      await repo.updateMusicInfo(ws.chatId, {
        currentSong: nextSong,
        queue: current.queue,
        progress: 0,
        state: "playing",
        playTime: Date.now(),
        finishedUsers: [],
      });

      broadcastToRoom(ws.chatId, {
        type: "music_set",
        content: {
          song: nextSong,
          queue: current.queue,
        },
        sender: ws.userId,
      });
    } else {
      // No more songs in the queue, just pause the music
      await repo.updateMusicInfo(ws.chatId, {
        currentSong: undefined,
        progress: 0,
        state: "paused",
        queue: [],
        skipVotes: [],
        playTime: undefined,
        finishedUsers: [],
      });

      broadcastToRoom(ws.chatId, {
        type: "music_set",
        content: {},
        sender: ws.userId,
      });
    }
  } else {
    // Not enough finished users, just update the finished users
    await repo.updateMusicInfo(ws.chatId, {
      ...current,
      finishedUsers: Array.from(finishedSet),
    });
  }
}

export async function handleAddSongRequest(ws: ChatWebSocket, payload: Song) {
  const repo = getChatRoomRepository();
  const current = await repo.getMusicInfo(ws.chatId);

  if (!current) {
    // If no music info exists, create a new one
    await repo.updateMusicInfo(ws.chatId, {
      currentSong: payload,
      progress: 0,
      state: "paused",
      playTime: undefined,
      queue: [],
    });

    broadcastToRoom(ws.chatId, {
      type: "music_set",
      content: payload,
      sender: ws.userId,
    });
  } else {
    // Add the song to the queue
    current.queue = current.queue || [];
    current.queue.push(payload);
    await repo.updateMusicInfo(ws.chatId, current);

    // queue updated
    broadcastToRoom(ws.chatId, {
      type: "music_queue_update",
      content: current.queue,
      sender: ws.userId,
    });
  }
}

export async function handleMusicSkipRequest(ws: ChatWebSocket, payload: any) {
  const repo = getChatRoomRepository();

  const current = await repo.getMusicInfo(ws.chatId);
  if (!current) return;

  const skipVotes = current.skipVotes || [];
  const userId = ws.userId;
  if (skipVotes.some((vote) => vote.userId === userId)) {
    // User has already voted to skip
    return;
  }

  // Add the user's vote to skip
  skipVotes.push({ userId });

  // if the number of votes exceeds half of the participants, skip the song
  const onlineCount = userStore.getOnlineUsersInRoom(ws.chatId).length;
  const requiredVotes = Math.ceil(onlineCount / 2);
  const hasEnoughVotes = skipVotes.length >= requiredVotes;

  if (hasEnoughVotes) {
    const nextSong = current.queue?.shift();
    if (nextSong) {
      // Set the next song as the current song
      await repo.updateMusicInfo(ws.chatId, {
        currentSong: nextSong,
        queue: current.queue,
        progress: 0,
        state: "playing",
        playTime: Date.now(),
        skipVotes: [],
        finishedUsers: [],
      });

      broadcastToRoom(ws.chatId, {
        type: "music_set",
        content: {
          song: nextSong,
          queue: current.queue,
        },
        sender: ws.userId,
      });

      sendSystemMessage(
        ws.chatId,
        `Song skipped by ${skipVotes.length} users. Now playing: ${nextSong.name}`
      );
    } else {
      // No more songs in the queue, just pause the music
      await repo.updateMusicInfo(ws.chatId, {
        currentSong: undefined,
        progress: 0,
        state: "paused",
        playTime: undefined,
        skipVotes: [],
      });

      broadcastToRoom(ws.chatId, {
        type: "music_set",
        content: {},
        sender: ws.userId,
      });
    }
  } else {
    // Not enough votes, just update the skip votes
    await repo.updateMusicInfo(ws.chatId, {
      ...current,
      skipVotes,
    });

    const nickname =
      (await repo.getNickname(ws.chatId, ws.userId)) || "Someone";
    sendSystemMessage(
      ws.chatId,
      `${nickname} voted to skip the song. ${skipVotes.length}/${requiredVotes} votes needed to skip.`
    );
  }

  broadcastToRoom(ws.chatId, {
    type: "music_skip_result",
    content: {
      skipVotes: skipVotes,
      skipThreshold: requiredVotes,
    },
  } as Packet<any, any>);
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

  await repo.updateMusicInfo(ws.chatId, {
    currentSong: payload,
    progress: 0,
    state: "paused",
    playTime: undefined,
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

export async function handleMusicPause(ws: ChatWebSocket, payload: any) {
  const repo = getChatRoomRepository();
  repo.updateMusicInfo(ws.chatId, {
    state: "paused",
  });

  const nickname = (await repo.getNickname(ws.chatId, ws.userId)) || "Someone";
  sendSystemMessage(ws.chatId, `${nickname} paused the music.`);

  broadcastToRoom(ws.chatId, {
    type: "music_pause",
    content: null,
    sender: ws.userId,
  });
}

export type { MusicPlayPayload, MusicSeekPayload, Song };
