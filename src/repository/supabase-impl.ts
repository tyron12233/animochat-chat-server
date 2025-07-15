import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type {
  ChatRoomInfo,
  ChatThemeV2,
  Message,
  MusicInfo,
  PublicRoomInfo,
  Reaction,
} from "../types";
import type { IChatRoomRepository } from "./chat-room-repository";

export class SupabaseChatRoomRepository implements IChatRoomRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  private handleError(error: PostgrestError | null, context: string) {
    if (error) {
      console.error(`Supabase error in ${context}:`, error);
      // Optionally throw the error to be handled by the caller
      // throw new Error(`Supabase error in ${context}: ${error.message}`);
    }
  }

  // --- Room Management ---
  async markClosed(chatId: string) {
    const { error } = await this.supabase
      .from("rooms")
      .update({ is_closed: true })
      .eq("id", chatId);
    this.handleError(error, "markClosed");
  }

  async isRoomClosed(chatId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("rooms")
      .select("is_closed")
      .eq("id", chatId)
      .single();
    this.handleError(error, "isRoomClosed");
    return data?.is_closed ?? false;
  }

  async createRoom(chatId: string, name: string, maxParticipants: number) {
    const { error } = await this.supabase.from("rooms").insert({
      id: chatId,
      name: name,
      max_participants: maxParticipants,
      theme: null,
      mode: "light",
      is_closed: false,
    });
    this.handleError(error, "createRoom");
  }

  async deleteRoom(chatId: string) {
    // With "ON DELETE CASCADE" in the schema, just deleting the room is enough.
    const { error } = await this.supabase
      .from("rooms")
      .delete()
      .eq("id", chatId);
    this.handleError(error, "deleteRoom");
    console.log(`[${chatId}] DELETED room from Supabase.`);
  }

  async roomExists(chatId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("rooms")
      .select("id")
      .eq("id", chatId)
      .maybeSingle(); // maybeSingle returns null if not found, instead of an error
    this.handleError(error, "roomExists");
    return !!data;
  }

  async listPublicRooms(): Promise<PublicRoomInfo[]> {
    const { data, error } = await this.supabase
      .from("rooms")
      .select("id, name, max_participants")
      .eq("is_public", true)
      .eq("is_closed", false);
    this.handleError(error, "listPublicRooms");
    return data || [];
  }

  async makeRoomPublic(chatId: string) {
    const { error } = await this.supabase
      .from("rooms")
      .update({ is_public: true })
      .eq("id", chatId);
    this.handleError(error, "makeRoomPublic");
  }

  async getRoomInfo(chatId: string) {
    const { data, error } = await this.supabase
      .from("rooms")
      .select("name, max_participants, theme, mode, is_closed")
      .eq("id", chatId)
      .single();
    this.handleError(error, "getRoomInfo");
    if (!data) return {};
    return data;
  }

  async getAllRoomIds(): Promise<string[]> {
    const { data, error } = await this.supabase.from("rooms").select("id");
    this.handleError(error, "getAllRoomIds");
    return data?.map((r) => r.id) || [];
  }

  // --- Message Management ---
  async updateReaction(chatId: string, reaction: Reaction): Promise<boolean> {
    // This is more complex in SQL. We use an RPC function for atomicity.
    // In Supabase SQL Editor, create this function:
    //
    // CREATE OR REPLACE FUNCTION update_message_reaction(
    //   p_message_id TEXT,
    //   p_user_id TEXT,
    //   p_emoji TEXT
    // ) RETURNS BOOLEAN AS $$
    // DECLARE
    //   v_reactions JSONB;
    //   v_reaction_index INT;
    // BEGIN
    //   -- Get current reactions for the message
    //   SELECT reactions INTO v_reactions FROM messages WHERE id = p_message_id;
    //
    //   -- If no reactions, initialize as an empty array
    //   IF v_reactions IS NULL THEN
    //     v_reactions := '[]'::JSONB;
    //   END IF;
    //
    //   -- Find the index of the reaction by the user
    //   SELECT idx - 1 INTO v_reaction_index
    //   FROM jsonb_array_elements(v_reactions) WITH ORDINALITY arr(val, idx)
    //   WHERE val->>'user_id' = p_user_id;
    //
    //   IF v_reaction_index IS NOT NULL THEN
    //     -- Reaction exists
    //     IF p_emoji IS NULL OR p_emoji = '' THEN
    //       -- Remove the reaction
    //       v_reactions := v_reactions - v_reaction_index;
    //     ELSE
    //       -- Update the reaction
    //       v_reactions := jsonb_set(v_reactions, ARRAY[v_reaction_index::TEXT],
    //         jsonb_build_object('message_id', p_message_id, 'user_id', p_user_id, 'emoji', p_emoji), false);
    //     END IF;
    //   ELSIF p_emoji IS NOT NULL AND p_emoji != '' THEN
    //     -- Add new reaction
    //     v_reactions := v_reactions || jsonb_build_object('message_id', p_message_id, 'user_id', p_user_id, 'emoji', p_emoji)::jsonb;
    //   END IF;
    //
    //   -- Update the message with the new reactions array
    //   UPDATE messages SET reactions = v_reactions WHERE id = p_message_id;
    //
    //   RETURN FOUND;
    // END;
    // $$ LANGUAGE plpgsql;
    const { data, error } = await this.supabase.rpc("update_message_reaction", {
      p_message_id: reaction.message_id,
      p_user_id: reaction.user_id,
      p_emoji: reaction.emoji,
    });
    this.handleError(error, "updateReaction");
    return data || false;
  }

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    const { error, count } = await this.supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("room_id", chatId);
    this.handleError(error, "deleteMessage");
    return count !== null && count > 0;
  }

  async deleteAllMessagesBy(chatId: string, sender: string): Promise<void> {
    const { error } = await this.supabase
      .from("messages")
      .delete()
      .eq("room_id", chatId)
      .eq("sender", sender);
    this.handleError(error, "deleteAllMessagesBy");
  }

  async markMessageAsDeleted(
    chatId: string,
    messageId: string
  ): Promise<boolean> {
    const { error, count } = await this.supabase
      .from("messages")
      .update({ type: "deleted", content: null }) // Also clear content
      .eq("id", messageId)
      .eq("room_id", chatId);
    this.handleError(error, "markMessageAsDeleted");
    return count !== null && count > 0;
  }

  async editMessage(
    chatId: string,
    messageId: string,
    newContent: string
  ): Promise<boolean> {
    const { error, count } = await this.supabase
      .from("messages")
      .update({ content: newContent, edited: true })
      .eq("id", messageId)
      .eq("room_id", chatId);
    this.handleError(error, "editMessage");
    return count !== null && count > 0;
  }

  async addMessage(chatId: string, message: Message) {
    const anyMessage: any = message;

    const { error } = await this.supabase.from("messages").insert({
      id: message.id,
      room_id: chatId,
      mentions: anyMessage.mentions || [],
      user_id: message.sender,
      content: message.content,
      type: message.type,
      reactions: [],
    });
    this.handleError(error, "addMessage");
  }

  async getMessages(
    chatId: string,
    start: number,
    end: number
  ): Promise<Message[]> {
    // Supabase range is inclusive, so adjust `end` if needed.
    // `end` in lrange is inclusive, so `end - start + 1` is the limit.
    const limit = end === -1 ? 1000 : end - start + 1; // Handle Redis's -1 convention
    const { data, error } = await this.supabase
      .from("messages")
      .select("*")
      .eq("room_id", chatId)
      .order("created_at", { ascending: false })
      .range(start, start + limit - 1);

    this.handleError(error, "getMessages");

    if (!data) return [];

    // Map Supabase columns to Message interface
    const messages: Message[] = data.map((msg) => ({
      id: msg.id,
      sender: msg.user_id,
      content: msg.content,
      created_at: new Date(msg.created_at).toISOString(),
      session_id: msg.room_id,
      replyingTo: msg.replyingTo || undefined,
      mentions: msg.mentions || [],
      type: msg.type,
      edited: msg.edited,
      reactions: (msg.reactions as Reaction[]) || [],
    }));

    return messages.reverse(); // To get chronological order
  }

  async getMessageCount(chatId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("room_id", chatId);
    this.handleError(error, "getMessageCount");
    return count || 0;
  }

  // --- Participant & Nickname Management ---
  async addParticipant(
    chatId: string,
    userId: string,
    initialNickname: string
  ) {
    const { error } = await this.supabase.from("participants").upsert({
      room_id: chatId,
      user_id: userId,
      nickname: initialNickname,
      is_ghost: false,
    });
    this.handleError(error, "addParticipant");
  }

  async removeParticipant(chatId: string, userId: string) {
    const { error } = await this.supabase
      .from("participants")
      .delete()
      .eq("room_id", chatId)
      .eq("user_id", userId);
    this.handleError(error, "removeParticipant");
  }

  async getParticipantIds(chatId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("participants")
      .select("user_id")
      .eq("room_id", chatId);
    this.handleError(error, "getParticipantIds");
    return data ? data.map((p) => p.user_id) : [];
  }

  async containsParticipant(chatId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("participants")
      .select("user_id")
      .eq("room_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    this.handleError(error, "containsParticipant");
    return !!data;
  }

  async getParticipantCount(chatId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("room_id", chatId);
    this.handleError(error, "getParticipantCount");
    return count || 0;
  }

  async getNicknames(chatId: string): Promise<Map<string, string>> {
    const { data, error } = await this.supabase
      .from("participants")
      .select("user_id, nickname")
      .eq("room_id", chatId);
    this.handleError(error, "getNicknames");
    const map = new Map<string, string>();
    if (data) {
      data.forEach((p) => map.set(p.user_id, p.nickname));
    }
    return map;
  }

  async getNickname(chatId: string, userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("participants")
      .select("nickname")
      .eq("room_id", chatId)
      .eq("user_id", userId)
      .single();
    this.handleError(error, "getNickname");

    if (data?.nickname && data.nickname.length > 20) {
      data.nickname = data.nickname.slice(0, 20);
    }

    return data?.nickname || null;
  }

  async setNickname(chatId: string, userId: string, newNickname: string) {
    const { error } = await this.supabase
      .from("participants")
      .update({ nickname: newNickname })
      .eq("room_id", chatId)
      .eq("user_id", userId);
    this.handleError(error, "setNickname");
  }

  // --- Ghost Mode ---
  async setGhostMode(chatId: string, userId: string, isGhost: boolean) {
    const { error } = await this.supabase
      .from("participants")
      .update({ is_ghost: isGhost })
      .eq("room_id", chatId)
      .eq("user_id", userId);
    this.handleError(error, "setGhostMode");
  }

  async isGhostMode(chatId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("participants")
      .select("is_ghost")
      .eq("room_id", chatId)
      .eq("user_id", userId)
      .single();
    this.handleError(error, "isGhostMode");
    return data?.is_ghost || false;
  }

  async getAllGhosts(chatId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("participants")
      .select("user_id")
      .eq("room_id", chatId)
      .eq("is_ghost", true);
    this.handleError(error, "getAllGhosts");
    return data ? data.map((p) => p.user_id) : [];
  }

  // --- Ban Management ---
  async banUser(chatId: string, userId: string) {
    const { error } = await this.supabase
      .from("bans")
      .insert({ room_id: chatId, banned_user_id: userId });
    this.handleError(error, "banUser");
  }

  async isUserBanned(chatId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("bans")
      .select("id")
      .eq("room_id", chatId)
      .eq("banned_user_id", userId)
      .maybeSingle();
    this.handleError(error, "isUserBanned");
    return !!data;
  }

  async banIp(chatId: string, ip: string) {
    const { error } = await this.supabase
      .from("banned_ips")
      .insert({ ip_address: ip });
    this.handleError(error, "banIp");
  }

  async isIpBanned(chatId: string, ip: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("banned_ips")
      .select("*")
      .eq("ip_address", ip)
      .maybeSingle();
    this.handleError(error, "isIpBanned");
    return !!data;
  }

  // --- Theme Management ---
  async setTheme(chatId: string, theme: ChatThemeV2, mode: "light" | "dark") {
    const { error } = await this.supabase
      .from("rooms")
      .update({ theme: theme as any, mode: mode })
      .eq("id", chatId);
    this.handleError(error, "setTheme");
  }

  async getTheme(
    chatId: string
  ): Promise<{ theme: ChatThemeV2 | null; mode: "light" | "dark" }> {
    const { data, error } = await this.supabase
      .from("rooms")
      .select("theme, mode")
      .eq("id", chatId)
      .single();
    this.handleError(error, "getTheme");
    return {
      theme: (data?.theme as ChatThemeV2) || null,
      mode: (data?.mode as "light" | "dark") || "light",
    };
  }

  // music info, { url, name, progress }
  async setMusicInfo(chatId: string, musicInfo: MusicInfo) {
    const { error } = await this.supabase
      .from("rooms")
      .update({ music_info: musicInfo })
      .eq("id", chatId);
    this.handleError(error, "setMusicInfo");
  }

  async getMusicInfo(chatId: string): Promise<MusicInfo | null> {
    const { data, error } = await this.supabase
      .from("rooms")
      .select("music_info")
      .eq("id", chatId)
      .single();
    this.handleError(error, "getMusicInfo");
    return data?.music_info || null;
  }

  async updateMusicInfo(chatId: string, musicInfo: Partial<MusicInfo>) {
    const { error } = await this.supabase.rpc("update_music_info", {
      room_id: chatId,
      new_info: musicInfo,
    });
    this.handleError(error, "updateMusicInfo");
  }
}
