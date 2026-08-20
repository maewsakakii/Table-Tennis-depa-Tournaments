"use client";

import type { Player, PublicPlayer, TournamentState } from "@/lib/types";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

export const PLAYER_STORAGE_KEY = "office-smash-player";
const PLAYERS_STORAGE_KEY = "office-smash-players";
const STATE_STORAGE_KEY = "office-smash-tournament-state";

export const initialTournamentState: TournamentState = {
  version: 0,
  status: "registration",
  roster: [],
  pairs: [],
  startedAt: null,
};

function toPublicPlayer(player: Player): PublicPlayer {
  return {
    id: player.id,
    nickname: player.nickname,
    department: player.department,
    avatarUrl: player.avatarUrl,
  };
}

function mapPlayerRow(row: Record<string, unknown>): Player {
  return {
    id: String(row.id),
    nickname: String(row.nickname),
    department: String(row.department),
    email: row.email ? String(row.email) : null,
    avatarUrl: String(row.avatar_url),
    registeredAt: String(row.registered_at),
    status: "waiting",
  };
}

function mapTournamentRow(row: Record<string, unknown>): TournamentState {
  return {
    version: Number(row.version ?? 0),
    status: (row.status as TournamentState["status"]) ?? "registration",
    roster: (row.roster as PublicPlayer[]) ?? [],
    pairs: (row.pairs as TournamentState["pairs"]) ?? [],
    startedAt: row.started_at ? String(row.started_at) : null,
  };
}

export async function registerPlayerOnline(player: Player, avatarFile: File | null) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !avatarFile) {
    saveLocalPlayer(player);
    return player;
  }

  const extension = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
  const avatarPath = `${player.id}/profile.${extension}`;
  const contentType = avatarFile.type || (
    extension === "heic" ? "image/heic" :
    extension === "heif" ? "image/heif" :
    extension === "png" ? "image/png" :
    extension === "webp" ? "image/webp" : "image/jpeg"
  );
  const { error: uploadError } = await supabase.storage
    .from("player-avatars")
    .upload(avatarPath, avatarFile, { upsert: true, contentType });

  if (uploadError) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}`);

  const { data: publicUrl } = supabase.storage.from("player-avatars").getPublicUrl(avatarPath);
  const onlinePlayer = { ...player, avatarUrl: publicUrl.publicUrl };
  const { error: insertError } = await supabase.from("players").insert({
    id: onlinePlayer.id,
    nickname: onlinePlayer.nickname,
    department: onlinePlayer.department,
    email: onlinePlayer.email || null,
    avatar_url: onlinePlayer.avatarUrl,
  });

  if (insertError) throw new Error(`บันทึกใบสมัครไม่สำเร็จ: ${insertError.message}`);
  window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(onlinePlayer));
  return onlinePlayer;
}

function saveLocalPlayer(player: Player) {
  const current = readLocalPlayers().filter((item) => item.id !== player.id);
  window.localStorage.setItem(PLAYERS_STORAGE_KEY, JSON.stringify([...current, player]));
  window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(player));
}

function readLocalPlayers(): Player[] {
  try {
    const players = JSON.parse(window.localStorage.getItem(PLAYERS_STORAGE_KEY) ?? "[]") as Player[];
    if (players.length) return players;
    const current = window.localStorage.getItem(PLAYER_STORAGE_KEY);
    return current ? [JSON.parse(current) as Player] : [];
  } catch {
    return [];
  }
}

export async function getAllPlayers() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return readLocalPlayers();

  const { data, error } = await supabase
    .from("players")
    .select("id,nickname,department,email,avatar_url,registered_at")
    .order("registered_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapPlayerRow(row));
}

export async function getTournamentState() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    try {
      return JSON.parse(window.localStorage.getItem(STATE_STORAGE_KEY) ?? "null") as TournamentState | null
        ?? initialTournamentState;
    } catch {
      return initialTournamentState;
    }
  }

  const { data, error } = await supabase
    .from("tournament_state")
    .select("version,status,roster,pairs,started_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTournamentRow(data) : initialTournamentState;
}

export async function saveTournamentState(state: TournamentState) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("office-smash-state", { detail: state }));
    return;
  }

  const { error } = await supabase.from("tournament_state").upsert({
    id: 1,
    version: state.version,
    status: state.status,
    roster: state.roster,
    pairs: state.pairs,
    started_at: state.startedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export function subscribeToTournamentState(onState: (state: TournamentState) => void) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STATE_STORAGE_KEY && event.newValue) onState(JSON.parse(event.newValue));
    };
    const onCustom = (event: Event) => onState((event as CustomEvent<TournamentState>).detail);
    window.addEventListener("storage", onStorage);
    window.addEventListener("office-smash-state", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("office-smash-state", onCustom);
    };
  }

  const channel = supabase
    .channel("tournament-state-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tournament_state", filter: "id=eq.1" },
      (payload) => payload.new && onState(mapTournamentRow(payload.new as Record<string, unknown>)),
    )
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}

export async function adminSignIn(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const { data: adminById } = await supabase.from("admin_users").select("user_id").maybeSingle();
  const { data: adminByEmail } = await supabase.from("admin_emails").select("email").maybeSingle();
  if (!adminById && !adminByEmail) {
    await supabase.auth.signOut();
    throw new Error("บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลการแข่งขัน");
  }
}

export async function getAdminSession() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { active: true, demo: true };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { active: false, demo: false };
  const { data: adminById } = await supabase.from("admin_users").select("user_id").maybeSingle();
  const { data: adminByEmail } = await supabase.from("admin_emails").select("email").maybeSingle();
  return { active: Boolean(adminById || adminByEmail), demo: false };
}

export async function adminSignOut() {
  const supabase = getSupabaseBrowserClient();
  if (supabase) await supabase.auth.signOut();
}

export function onlineModeLabel() {
  return isSupabaseConfigured() ? "SUPABASE LIVE" : "LOCAL DEMO";
}

export { toPublicPlayer };
