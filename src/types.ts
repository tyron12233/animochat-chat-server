// CLIENT TYPES TINATAMAD ISHARE WITH THE CLIENT COPY PASTE MUNA

import type WebSocket from "ws";

export interface ChatRoomInfo {
  id: string;
  name: string;
  // remove connections: Set<WebSocket>;
  participants: Omit<Participant, "connections">[];
  max_participants: number;
}

export interface PublicRoomInfo {
  id: string;
  name: string;
  max_participants: number;
}

export interface Participant {
  connections: Set<WebSocket>;
  userId: string;
  nickname: string;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string | null;
}

interface BaseMessage {
  id: string;
  session_id: string;
  created_at: string; // ISO string
  edited?: boolean;
  senderNickname?: string;
}

export interface SystemMessage extends BaseMessage {
  type: "system";
  content: string;
  sender: "system";
}

export interface UserMessage extends BaseMessage {
  type?: undefined | "deleted"; // or 'user'
  content: string;
  sender: string; // peerId
  replyingTo?: string;
  reactions?: Reaction[];
  mentions?: Mention[];
}


export interface Mention {
  id: string;
  startIndex: number;
  endIndex: number;
}

export type Message = UserMessage | SystemMessage;

export type Song = {
  name: string;
  url: string;
}

export interface MusicInfo {
  currentSong?: Song;
  progress: number;
  state: 'playing' | 'paused';
  playTime?: number; 
  queue?: Song[];
  skipVotes?: { userId: string }[]
  finishedUsers?: string[];
}

export interface ColorScheme {
  light: string;
  dark: string;
}

export interface ButtonTheme {
  background: ColorScheme;
  text: ColorScheme;
  hoverBackground: ColorScheme;
  border?: ColorScheme;
}

export interface ChatThemeV2 {
  name: string;
  typography: {
    fontFamily: string;
    baseFontSize: string;
  };

  reactions: {
    bubble: {
      background: ColorScheme;
      border: ColorScheme;
      text: ColorScheme;
    };
  };

  general: {
    background: ColorScheme;
    backdropBlur: string;
    shadow: string;
    borderRadius: string;
  };

  header: {
    background: ColorScheme;
    border: ColorScheme;
    statusLabel: ColorScheme;
    statusValue: ColorScheme;
  };

  announcement: {
    background: ColorScheme;
    text: ColorScheme;
    border: ColorScheme;
  };

  messageList: {
    scrollbarThumb: ColorScheme;
    scrollbarTrack: ColorScheme;
  };

  message: {
    // Message bubbles for the current user
    myMessage: {
      background: ColorScheme;
      text: ColorScheme;
      isAnimated: boolean;
    };
    // Message bubbles for the other user (stranger)
    strangerMessage: {
      background: ColorScheme;
      text: ColorScheme;
      isAnimated: boolean;
    };
    deletedMessage: { text: ColorScheme };
    imageOverlay: { background: ColorScheme; text: ColorScheme };
    // System messages like "Chat ended"
    systemMessage: {
      background: ColorScheme;
      text: ColorScheme;
    };
  };

  inputArea: {
    background: ColorScheme;
    border: ColorScheme;
    inputBackground: ColorScheme;
    inputText: ColorScheme;
    placeholderText: ColorScheme;
    focusRing: ColorScheme;
  };

  accent: {
    main: ColorScheme;
    faded: ColorScheme;
  };

  secondaryText: ColorScheme;
  errorText: ColorScheme;
  linkColor: ColorScheme;

  buttons: {
    primary: ButtonTheme; // e.g., Send, New Chat
    secondary: ButtonTheme; // e.g., End Chat
    destructive: ButtonTheme; // e.g., Confirm End
    newMessages: ButtonTheme; // The "New Messages" button
  };

  overlays: {
    replyingPreview: {
      background: ColorScheme;
      border: ColorScheme;
      title: ColorScheme;
      description: ColorScheme;
      closeIcon: ColorScheme;
    };
    emojiMenu: {
      background: ColorScheme;
      shadow: string;
    };
  };

  animations: {
    typingIndicatorDots: ColorScheme;
  };
}

// PACKETS

export interface Packet<T, K extends String> {
  type: string;
  content: T;
  sender: string;
}

export type BanPacket = Packet<string, "ban">;
// This packet is used when the user is offline or not connected.
// the content is a string (the user id of the user who when offline).
export type OfflinePacket = Packet<string, "offline">;

export type ChangeNicknamePacket = Packet<
  {
    userId: string;
    newNickname: string;
  },
  "change_nickname"
>;

export type MessagesSyncPacket = Packet<Message[], "messages_sync">;
export type ParticipantsSyncPacket = Packet<
  Omit<Participant, "connections">[],
  "participants_sync"
>;
export type ParticipantJoinedPacket = Packet<
  Omit<Participant, "connections">,
  "participant_joined"
>;

export type MessagePacket = Packet<Message, "message">;

export type MessageAcknowledgmentPacket = Packet<
  {
    messageId: string;
    sender: string;
  },
  "message_acknowledgment"
>;

export type ReactionPacket = Packet<Reaction, "reaction">;
export type TypingPacket = Packet<boolean, "typing">;
export type EditMessagePacket = Packet<
  { message_id: string; new_content: string; user_id: string },
  "edit_message"
>;
export type DisconnectPacket = Packet<null, "disconnect">;
export type ChangeThemePacket = Packet<
  {
    mode: "light" | "dark";
    theme: ChatThemeV2;
  },
  "change_theme"
>;
