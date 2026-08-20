"use client";

import { generateRecoveryCode, nextPublicPlayerId, normalizeRecoveryCode } from "./player-identity.ts";
import type {
  AdminDraw,
  BracketMatch,
  KnockoutBracket,
  Player,
  PlayerIdentity,
  PlayerRegistration,
  PlayerReveal,
  PlayerTournamentSnapshot,
  PublicPlayer,
  TournamentSnapshot,
  TournamentState,
} from "./types.ts";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "./supabase.ts";
import { compressAvatarForLocalStorage } from "./local-avatar.ts";
import { generateKnockoutBracket, recordBracketScore } from "./bracket.ts";

export const PLAYER_STORAGE_KEY = "office-smash-player";
const PLAYERS_STORAGE_KEY = "office-smash-players";
const STATE_STORAGE_KEY = "office-smash-tournament-state";
const DRAW_STORAGE_KEY = "office-smash-hidden-draw";
const RECOVERY_STORAGE_KEY = "office-smash-demo-recovery";

type StoredPlayerSession = { player?: Player; playerId?: string; recoveryCode?: string };
type LegacyTournamentState = Omit<Partial<TournamentState>, "status"> & {
  status?: TournamentState["status"] | "drawing" | "ready";
  roster?: unknown;
  pairs?: unknown;
  registration_open?: boolean;
  reveal_open?: boolean;
  started_at?: string | null;
};

export type AdminSessionState = { active: boolean; demo: boolean; configurationError: boolean };

export const initialTournamentState: TournamentState = {
  version: 0,
  status: "registration",
  registrationOpen: true,
  revealOpen: false,
  startedAt: null,
};

export function isLocalDemoEnabled(
  nodeEnv = process.env.NODE_ENV,
  demoFlag = process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO,
) {
  return nodeEnv !== "production" && demoFlag === "true";
}

function missingBackendError() {
  return new Error("ยังไม่ได้เชื่อมต่อ Supabase และ Local Demo ไม่ได้เปิดใช้งาน");
}

function assertAvailableBackend() {
  if (!isSupabaseConfigured() && !isLocalDemoEnabled()) throw missingBackendError();
}

export function toPublicPlayer(player: Player): PublicPlayer {
  return { id: player.id, nickname: player.nickname, department: player.department, avatarUrl: player.avatarUrl };
}

function mapPlayerRow(row: Record<string, unknown>): Player {
  return {
    id: String(row.public_id ?? row.id),
    nickname: String(row.nickname),
    department: String(row.department),
    email: row.email ? String(row.email) : null,
    avatarUrl: String(row.avatar_url),
    registeredAt: String(row.registered_at),
    status: "waiting",
    isDemo: Boolean(row.is_demo),
    demoSlot: row.demo_slot == null ? null : Number(row.demo_slot),
  };
}

/** Converts legacy Phase 2 JSON into the intentionally tiny public state. */
export function compactTournamentState(value: unknown): TournamentState {
  const row = value && typeof value === "object" ? value as LegacyTournamentState : {};
  const legacyStatus = row.status;
  const registrationOpen = typeof row.registrationOpen === "boolean"
    ? row.registrationOpen
    : typeof row.registration_open === "boolean"
      ? row.registration_open
      : legacyStatus === undefined || legacyStatus === "registration";
  const revealOpen = typeof row.revealOpen === "boolean"
    ? row.revealOpen
    : typeof row.reveal_open === "boolean"
      ? row.reveal_open
      : legacyStatus === "ready";
  const locked = legacyStatus === "drawing" || legacyStatus === "ready" || legacyStatus === "locked";
  const version = Number.isFinite(Number(row.version)) ? Number(row.version) : 0;
  return {
    version,
    status: locked || !registrationOpen ? "locked" : "registration",
    registrationOpen,
    revealOpen: revealOpen && !registrationOpen && locked && version > 0,
    startedAt: row.startedAt ? String(row.startedAt) : row.started_at ? String(row.started_at) : null,
  };
}

function assertValidTournamentState(state: TournamentState) {
  if (state.registrationOpen && state.revealOpen) {
    throw new Error("ไม่สามารถเปิดรับสมัครพร้อมกับเปิดเผยคู่แข่งขันได้");
  }
  if (state.revealOpen && (state.status !== "locked" || state.version < 1)) {
    throw new Error("ต้องสุ่มและล็อกคู่แข่งขันก่อนเปิดให้ดูคู่แข่ง");
  }
}

function mapTournamentRow(row: Record<string, unknown>) {
  return compactTournamentState(row);
}

function parseStoredPlayer(value: string | null): Player | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as Partial<Player> | StoredPlayerSession;
    if ("player" in stored && stored.player) return stored.player;
    const legacy = stored as Partial<Player>;
    return legacy.id && legacy.nickname && legacy.avatarUrl ? legacy as Player : null;
  } catch {
    return null;
  }
}

function parseStoredSession(value: string | null): StoredPlayerSession | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as StoredPlayerSession;
    return stored.player?.id || stored.playerId ? stored : null;
  } catch {
    return null;
  }
}

function readLocalPlayers(): Player[] {
  try {
    const players = JSON.parse(window.localStorage.getItem(PLAYERS_STORAGE_KEY) ?? "[]") as Player[];
    if (players.length) return players;
    const current = parseStoredPlayer(window.localStorage.getItem(PLAYER_STORAGE_KEY));
    return current ? [current] : [];
  } catch {
    return [];
  }
}

function cachePlayerSession(player: Player, recoveryCode?: string) {
  const serialized = JSON.stringify({ player, recoveryCode } satisfies StoredPlayerSession);
  try {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, serialized);
  } catch (cause) {
    if (!isQuotaExceededError(cause)) return;
    window.localStorage.removeItem(PLAYER_STORAGE_KEY);
    window.localStorage.removeItem(PLAYERS_STORAGE_KEY);
    window.localStorage.removeItem(STATE_STORAGE_KEY);
    window.localStorage.removeItem(DRAW_STORAGE_KEY);
    window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
    try { window.localStorage.setItem(PLAYER_STORAGE_KEY, serialized); }
    catch { window.localStorage.removeItem(PLAYER_STORAGE_KEY); }
  }
}

export function cacheOnlinePlayer(player: Player, recoveryCode?: string) {
  cachePlayerSession(player, recoveryCode);
}

export async function registerPlayerWithIdentity(player: Player, avatarFile: File | null): Promise<PlayerRegistration> {
  const supabase = getSupabaseBrowserClient();
  const recoveryCode = generateRecoveryCode();
  if (!supabase) {
    assertAvailableBackend();
    const players = readLocalPlayers();
    const localPlayer: Player = {
      ...player,
      id: nextPublicPlayerId(players.map((item) => item.id)),
      avatarUrl: avatarFile ? await compressAvatarForLocalStorage(avatarFile, player.avatarUrl) : player.avatarUrl,
    };
    saveLocalPlayer(localPlayer, recoveryCode);
    return { player: localPlayer, recoveryCode };
  }

  if (!avatarFile) throw new Error("กรุณาเลือกรูปหน้าจริงก่อนสมัคร");
  const extension = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
  const avatarPath = `pending/${crypto.randomUUID()}.${extension}`;
  const contentType = avatarFile.type || (
    extension === "heic" ? "image/heic" : extension === "heif" ? "image/heif" :
    extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg"
  );
  const { error: uploadError } = await supabase.storage
    .from("player-avatars").upload(avatarPath, avatarFile, { upsert: false, contentType });
  if (uploadError) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}`);
  const { data: publicUrl } = supabase.storage.from("player-avatars").getPublicUrl(avatarPath);
  const { data, error } = await supabase.rpc("register_player", {
    p_nickname: player.nickname,
    p_department: player.department,
    p_avatar_url: publicUrl.publicUrl,
    p_identity_token: recoveryCode,
  });
  if (error) {
    void supabase.storage.from("player-avatars").remove([avatarPath]);
    throw new Error(`บันทึกใบสมัครไม่สำเร็จ: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("ระบบไม่ได้ส่งข้อมูลผู้เล่นกลับมา");
  const onlinePlayer = mapPlayerRow(row);
  cachePlayerSession(onlinePlayer, recoveryCode);
  return { player: onlinePlayer, recoveryCode };
}

/** Backward-compatible wrapper. New UI should display recoveryCode from registerPlayerWithIdentity. */
export async function registerPlayerOnline(player: Player, avatarFile: File | null) {
  return (await registerPlayerWithIdentity(player, avatarFile)).player;
}

export function saveLocalPlayer(player: Player, recoveryCode?: string) {
  const previousCurrentPlayer = window.localStorage.getItem(PLAYER_STORAGE_KEY);
  const previousTournamentState = window.localStorage.getItem(STATE_STORAGE_KEY);
  const current = readLocalPlayers().filter((item) => item.id !== player.id);
  const roster = JSON.stringify([...current, player]);
  const pointer = recoveryCode
    ? JSON.stringify({ playerId: player.id, recoveryCode } satisfies StoredPlayerSession)
    : JSON.stringify({ playerId: player.id });
  try {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, pointer);
    window.localStorage.setItem(PLAYERS_STORAGE_KEY, roster);
  } catch (cause) {
    if (!isQuotaExceededError(cause)) {
      restoreStorageValue(PLAYER_STORAGE_KEY, previousCurrentPlayer);
      restoreStorageValue(STATE_STORAGE_KEY, previousTournamentState);
      throw cause;
    }
    window.localStorage.removeItem(STATE_STORAGE_KEY);
    window.localStorage.removeItem(DRAW_STORAGE_KEY);
    try {
      window.localStorage.setItem(PLAYER_STORAGE_KEY, pointer);
      window.localStorage.setItem(PLAYERS_STORAGE_KEY, roster);
    } catch (retryCause) {
      restoreStorageValue(PLAYER_STORAGE_KEY, previousCurrentPlayer);
      restoreStorageValue(STATE_STORAGE_KEY, previousTournamentState);
      if (!isQuotaExceededError(retryCause)) throw retryCause;
      throw new Error("พื้นที่จัดเก็บของเบราว์เซอร์เต็ม กรุณาล้างข้อมูลเว็บไซต์นี้แล้วสมัครอีกครั้ง");
    }
  }
}

function restoreStorageValue(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { window.localStorage.removeItem(key); }
}

function isQuotaExceededError(cause: unknown) {
  return cause instanceof DOMException && (
    cause.name === "QuotaExceededError" || cause.name === "NS_ERROR_DOM_QUOTA_REACHED"
  );
}

export function readSavedPlayer() {
  const storedValue = window.localStorage.getItem(PLAYER_STORAGE_KEY);
  const storedPlayer = parseStoredPlayer(storedValue);
  if (storedPlayer) return storedPlayer;
  try {
    const pointer = JSON.parse(storedValue ?? "null") as { playerId?: string } | null;
    return pointer?.playerId ? readLocalPlayers().find((player) => player.id === pointer.playerId) ?? null : null;
  } catch { return null; }
}

export function readPlayerIdentity(): PlayerIdentity | null {
  const session = parseStoredSession(window.localStorage.getItem(PLAYER_STORAGE_KEY));
  const playerId = session?.player?.id ?? session?.playerId;
  return session?.recoveryCode && playerId ? { playerId, recoveryCode: session.recoveryCode } : null;
}

function clearStoredPlayerSessionIfMatches(playerId: string) {
  const storedValue = window.localStorage.getItem(PLAYER_STORAGE_KEY);
  const session = parseStoredSession(storedValue);
  const legacyPlayer = parseStoredPlayer(storedValue);
  const storedPlayerId = session?.player?.id ?? session?.playerId ?? legacyPlayer?.id;
  if (storedPlayerId === playerId) {
    window.localStorage.removeItem(PLAYER_STORAGE_KEY);
  }
  const recoveryMap = readLocalRecoveryMap();
  if (playerId in recoveryMap) {
    delete recoveryMap[playerId];
    try { window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(recoveryMap)); }
    catch { /* deletion already succeeded; stale demo recovery data is non-critical */ }
  }
}

/**
 * Revalidates modern recovery-backed sessions before showing the Lobby.
 * Legacy sessions intentionally remain readable until an admin issues a recovery code.
 */
export async function restoreSavedPlayerSession(): Promise<Player | null> {
  const identity = readPlayerIdentity();
  const legacyPlayer = readSavedPlayer();
  if (!identity) return legacyPlayer;
  try {
    return await restorePlayerWithRecoveryCode(identity.recoveryCode);
  } catch (cause) {
    if (cause instanceof Error && [
      "ไม่พบผู้เล่นสำหรับรหัสนี้",
      "รูปแบบรหัสกู้คืนไม่ถูกต้อง",
      "invalid player identity",
    ].includes(cause.message)) {
      clearStoredPlayerSessionIfMatches(identity.playerId);
      return null;
    }
    throw cause;
  }
}

export async function restorePlayerWithRecoveryCode(value: string) {
  const recoveryCode = normalizeRecoveryCode(value);
  if (!recoveryCode) throw new Error("รูปแบบรหัสกู้คืนไม่ถูกต้อง");
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    const session = parseStoredSession(window.localStorage.getItem(PLAYER_STORAGE_KEY));
    let playerId = session?.recoveryCode === recoveryCode ? session.player?.id ?? session.playerId : undefined;
    if (!playerId) {
      const recoveryMap = readLocalRecoveryMap();
      playerId = Object.entries(recoveryMap).find(([, code]) => code === recoveryCode)?.[0];
    }
    const player = session?.recoveryCode === recoveryCode && session.player
      ? session.player
      : readLocalPlayers().find((item) => item.id === playerId);
    if (!player) throw new Error("ไม่พบผู้เล่นสำหรับรหัสนี้");
    saveLocalPlayer(player, recoveryCode);
    return player;
  }
  const { data, error } = await supabase.rpc("restore_player", { p_identity_token: recoveryCode });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("ไม่พบผู้เล่นสำหรับรหัสนี้");
  const player = mapPlayerRow(row);
  cachePlayerSession(player, recoveryCode);
  return player;
}

export async function getAllPlayers() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) { assertAvailableBackend(); return readLocalPlayers(); }
  const { data, error } = await supabase.from("players")
    .select("public_id,nickname,department,email,avatar_url,registered_at,is_demo,demo_slot")
    .order("registered_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapPlayerRow(row));
}

export async function getTournamentState() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    try { return compactTournamentState(JSON.parse(window.localStorage.getItem(STATE_STORAGE_KEY) ?? "null")); }
    catch { return initialTournamentState; }
  }
  const { data, error } = await supabase.from("tournament_state")
    .select("version,status,registration_open,reveal_open,started_at").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTournamentRow(data) : initialTournamentState;
}

export async function saveTournamentState(state: TournamentState) {
  assertValidTournamentState(state);
  const compact = compactTournamentState(state);
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(compact));
    window.dispatchEvent(new CustomEvent("office-smash-state", { detail: compact }));
    return;
  }
  const { error } = await supabase.rpc("admin_update_tournament_controls", {
    p_registration_open: compact.registrationOpen,
    p_reveal_open: compact.revealOpen,
  });
  if (error) throw new Error(error.message);
}

export function subscribeToTournamentState(onState: (state: TournamentState) => void) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    if (!isLocalDemoEnabled()) return () => undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === STATE_STORAGE_KEY && event.newValue) {
        try { onState(compactTournamentState(JSON.parse(event.newValue))); } catch { /* ignore corrupt state */ }
      }
    };
    const onCustom = (event: Event) => onState(compactTournamentState((event as CustomEvent).detail));
    window.addEventListener("storage", onStorage);
    window.addEventListener("office-smash-state", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("office-smash-state", onCustom);
    };
  }
  const channel = supabase.channel("tournament-state-live").on(
    "postgres_changes",
    { event: "*", schema: "public", table: "tournament_state", filter: "id=eq.1" },
    (payload) => payload.new && onState(mapTournamentRow(payload.new as Record<string, unknown>)),
  ).subscribe();
  return () => { void supabase.removeChannel(channel); };
}

function shuffleIds(ids: string[]) {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function emptyBracket(version = 0): KnockoutBracket {
  return { version, bracketRevision: 0, roundCount: 0, matches: [] };
}

function readLocalBracket(expectedVersion = 0): KnockoutBracket {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DRAW_STORAGE_KEY) ?? "null") as KnockoutBracket | null;
    return stored?.matches ? stored : emptyBracket(expectedVersion);
  } catch { return emptyBracket(expectedVersion); }
}

function writeLocalBracket(bracket: KnockoutBracket) {
  const serialized = JSON.stringify(bracket);
  // This payload deliberately contains IDs, topology and scores only—never avatars.
  if (/avatar|data:image/i.test(serialized)) throw new Error("ข้อมูลสายการแข่งขันมีรูปภาพที่ไม่ควรถูกจัดเก็บ");
  try { window.localStorage.setItem(DRAW_STORAGE_KEY, serialized); }
  catch (cause) {
    if (isQuotaExceededError(cause)) throw new Error("พื้นที่จัดเก็บไม่พอสำหรับบันทึกผลจับคู่และสายการแข่งขัน กรุณาล้างข้อมูล Local Demo แล้วลองอีกครั้ง");
    throw cause;
  }
}

function legacyDrawFromBracket(bracket: KnockoutBracket): AdminDraw {
  const firstRound = bracket.matches.filter((match) => match.round === 1);
  const placed = [
    ...firstRound.filter((match) => match.player1Id && match.player2Id)
      .flatMap((match) => [match.player1Id!, match.player2Id!]),
    ...firstRound.filter((match) => match.status === "bye").map((match) => match.winnerId!),
  ];
  return { version: bracket.version, pairs: Array.from({ length: Math.ceil(placed.length / 2) }, (_, index) => ({
    id: `legacy-${bracket.version}-${index}`, player1Id: placed[index * 2], player2Id: placed[index * 2 + 1] ?? null,
  })) };
}

function mapBracketMatch(row: Record<string, unknown>): BracketMatch {
  return {
    id: String(row.id ?? row.match_id),
    version: Number(row.version ?? row.draw_version),
    round: Number(row.round ?? row.round_number),
    position: Number(row.position ?? row.match_position),
    player1Id: row.player1Id ? String(row.player1Id) : row.player1_public_id ? String(row.player1_public_id) : null,
    player2Id: row.player2Id ? String(row.player2Id) : row.player2_public_id ? String(row.player2_public_id) : null,
    source1MatchId: row.source1MatchId ? String(row.source1MatchId) : row.source1_match_id ? String(row.source1_match_id) : null,
    source2MatchId: row.source2MatchId ? String(row.source2MatchId) : row.source2_match_id ? String(row.source2_match_id) : null,
    nextMatchId: row.nextMatchId ? String(row.nextMatchId) : row.next_match_id ? String(row.next_match_id) : null,
    nextSlot: (row.nextSlot ?? row.next_slot) == null ? null : Number(row.nextSlot ?? row.next_slot) as 1 | 2,
    score1: (row.score1 ?? row.score_player1) == null ? null : Number(row.score1 ?? row.score_player1),
    score2: (row.score2 ?? row.score_player2) == null ? null : Number(row.score2 ?? row.score_player2),
    winnerId: row.winnerId ? String(row.winnerId) : row.winner_public_id ? String(row.winner_public_id) : null,
    status: String(row.status) as BracketMatch["status"],
    revision: Number(row.revision ?? 0),
  };
}

function mapSnapshotPayload(payload: unknown): TournamentSnapshot {
  const row = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown> | null;
  if (!row) return { ...emptyBracket(), players: [] };
  const players = (row.players ?? []) as Record<string, unknown>[];
  const matches = (row.matches ?? []) as Record<string, unknown>[];
  return {
    version: Number(row.version ?? row.draw_version ?? 0),
    bracketRevision: Number(row.bracketRevision ?? row.bracket_revision ?? 0),
    roundCount: Number(row.roundCount ?? row.round_count ?? 0),
    players: players.map((player) => ({
      id: String(player.id ?? player.public_id), nickname: String(player.nickname),
      department: String(player.department), avatarUrl: String(player.avatarUrl ?? player.avatar_url),
    })),
    matches: matches.map(mapBracketMatch),
  };
}

/** Creates the complete, compact knockout tree. UI animation must reveal this server result, never re-roll it. */
export async function generateTournamentBracket(): Promise<TournamentSnapshot> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { error } = await supabase.rpc("admin_generate_hidden_draw");
    if (error) throw new Error(error.message);
    return getAdminTournamentSnapshot();
  }
  assertAvailableBackend();
  const players = readLocalPlayers();
  const current = await getTournamentState();
  const bracket = generateKnockoutBracket(players.map((player) => player.id), current.version + 1, shuffleIds);
  const previousDraw = window.localStorage.getItem(DRAW_STORAGE_KEY);
  try {
    await saveTournamentState({
      version: bracket.version, status: "locked", registrationOpen: false,
      revealOpen: true, startedAt: new Date().toISOString(),
    });
    writeLocalBracket(bracket);
  } catch (cause) {
    restoreStorageValue(DRAW_STORAGE_KEY, previousDraw);
    // Keep the small pre-draw state rather than attempting to restore legacy avatar-heavy JSON.
    try { await saveTournamentState(current); } catch { /* preserve the actionable original failure */ }
    throw cause;
  }
  return { ...bracket, players: players.map(toPublicPlayer) };
}

export async function generateHiddenAssignments(): Promise<AdminDraw> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    const snapshot = await generateTournamentBracket();
    return legacyDrawFromBracket(snapshot);
  }
  const { data, error } = await supabase.rpc("admin_generate_hidden_draw");
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { draw_version?: number } | null;
  return getAdminDraw(Number(row?.draw_version ?? 0));
}

export async function getAdminDraw(expectedVersion?: number): Promise<AdminDraw> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    try {
      const stored = JSON.parse(window.localStorage.getItem(DRAW_STORAGE_KEY) ?? "null") as AdminDraw | KnockoutBracket | null;
      if (stored && "matches" in stored) return legacyDrawFromBracket(stored);
      return stored ?? { version: expectedVersion ?? 0, pairs: [] };
    } catch { return { version: expectedVersion ?? 0, pairs: [] }; }
  }
  const { data, error } = await supabase.rpc("admin_get_hidden_draw");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    version: expectedVersion ?? Number(rows[0]?.draw_version ?? 0),
    pairs: rows.map((row) => ({
      id: String(row.match_id),
      player1Id: String(row.player1_public_id),
      player2Id: row.player2_public_id ? String(row.player2_public_id) : null,
    })),
  };
}

export async function getAdminTournamentSnapshot(): Promise<TournamentSnapshot> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    const bracket = readLocalBracket((await getTournamentState()).version);
    return { ...bracket, players: readLocalPlayers().map(toPublicPlayer) };
  }
  const { data, error } = await supabase.rpc("admin_get_tournament_snapshot");
  if (error) throw new Error(error.message);
  return mapSnapshotPayload(data);
}

export async function getPlayerTournamentSnapshot(): Promise<PlayerTournamentSnapshot> {
  const identity = readPlayerIdentity();
  if (!identity) throw new Error("ไม่พบสิทธิ์ผู้เล่นในเครื่องนี้ กรุณาใช้รหัสกู้คืน");
  const supabase = getSupabaseBrowserClient();
  let snapshot: TournamentSnapshot;
  if (!supabase) {
    assertAvailableBackend();
    const recoveryMap = readLocalRecoveryMap();
    const session = parseStoredSession(window.localStorage.getItem(PLAYER_STORAGE_KEY));
    if (session?.recoveryCode !== identity.recoveryCode && recoveryMap[identity.playerId] !== identity.recoveryCode) {
      throw new Error("invalid player identity");
    }
    snapshot = await getAdminTournamentSnapshot();
  } else {
    const { data, error } = await supabase.rpc("get_player_tournament_snapshot", {
      p_public_id: identity.playerId, p_identity_token: identity.recoveryCode,
    });
    if (error) throw new Error(error.message);
    snapshot = mapSnapshotPayload(data);
  }
  const latest = snapshot.matches
    .filter((match) => match.player1Id === identity.playerId || match.player2Id === identity.playerId)
    .sort((left, right) => right.round - left.round)[0] ?? null;
  const current = latest?.status === "ready" || latest?.status === "bye"
    ? latest
    : latest?.status === "waiting"
      ? snapshot.matches
        .filter((match) => match.status === "bye" && (match.player1Id === identity.playerId || match.player2Id === identity.playerId))
        .sort((left, right) => right.round - left.round)[0] ?? null
      : null;
  const opponentId = current
    ? current.player1Id === identity.playerId ? current.player2Id : current.player1Id
    : null;
  return {
    ...snapshot, playerId: identity.playerId, currentMatchId: current?.id ?? null,
    currentOpponentId: opponentId, bye: current?.status === "bye",
  };
}

export async function recordMatchScore(
  matchId: string, score1: number, score2: number, expectedRevision: number,
): Promise<TournamentSnapshot> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { error } = await supabase.rpc("admin_record_match_score", {
      p_match_id: matchId, p_score_player1: score1, p_score_player2: score2,
      p_expected_revision: expectedRevision,
    });
    if (error) throw new Error(error.message);
    return getAdminTournamentSnapshot();
  }
  assertAvailableBackend();
  const before = readLocalBracket((await getTournamentState()).version);
  const updated = recordBracketScore(before, matchId, score1, score2, expectedRevision);
  writeLocalBracket(updated);
  window.dispatchEvent(new CustomEvent("office-smash-bracket", { detail: updated }));
  return { ...updated, players: readLocalPlayers().map(toPublicPlayer) };
}

export async function updateTournamentControls(changes: Partial<Pick<TournamentState, "registrationOpen" | "revealOpen">>) {
  const current = await getTournamentState();
  const candidate = { ...current, ...changes };
  assertValidTournamentState(candidate);
  const reopeningRegistration = changes.registrationOpen === true && !current.registrationOpen;
  if (reopeningRegistration && !getSupabaseBrowserClient()) {
    const previousDraw = window.localStorage.getItem(DRAW_STORAGE_KEY);
    const reopened: TournamentState = {
      ...current,
      version: current.version + 1,
      status: "registration",
      registrationOpen: true,
      revealOpen: false,
      startedAt: null,
    };
    window.localStorage.removeItem(DRAW_STORAGE_KEY);
    try { await saveTournamentState(reopened); }
    catch (cause) { restoreStorageValue(DRAW_STORAGE_KEY, previousDraw); throw cause; }
    return reopened;
  }
  const next = compactTournamentState(candidate);
  await saveTournamentState(next);
  return next;
}

const DEMO_PLAYER_PROFILES = [
  ["พี่แอม", "การตลาด"],
  ["นัท", "ไอที / ผลิตภัณฑ์"],
  ["ปิง", "ฝ่ายขาย"],
  ["เจ", "ปฏิบัติการ"],
  ["มุก", "การตลาด"],
  ["ต้น", "ไอที / ผลิตภัณฑ์"],
  ["แพรว", "ฝ่ายขาย"],
  ["บอส", "ปฏิบัติการ"],
  ["ฟ้า", "กลยุทธ์องค์กร"],
  ["นนท์", "ทรัพยากรบุคคล"],
] as const;

function writeLocalPlayers(players: Player[]) {
  try {
    window.localStorage.setItem(PLAYERS_STORAGE_KEY, JSON.stringify(players));
  } catch (cause) {
    if (isQuotaExceededError(cause)) throw new Error("พื้นที่จัดเก็บไม่พอสำหรับเพิ่มผู้เล่น Demo");
    throw cause;
  }
}

async function invalidateLocalDrawAfterRosterChange() {
  const current = await getTournamentState();
  window.localStorage.removeItem(DRAW_STORAGE_KEY);
  await saveTournamentState({
    ...current,
    version: current.version + 1,
    status: current.registrationOpen ? "registration" : "locked",
    revealOpen: false,
    startedAt: null,
  });
}

async function persistLocalRosterChange(players: Player[]) {
  const previousRoster = window.localStorage.getItem(PLAYERS_STORAGE_KEY);
  const previousDraw = window.localStorage.getItem(DRAW_STORAGE_KEY);
  const previousState = window.localStorage.getItem(STATE_STORAGE_KEY);
  try {
    writeLocalPlayers(players);
    await invalidateLocalDrawAfterRosterChange();
  } catch (cause) {
    restoreStorageValue(PLAYERS_STORAGE_KEY, previousRoster);
    restoreStorageValue(DRAW_STORAGE_KEY, previousDraw);
    restoreStorageValue(STATE_STORAGE_KEY, previousState);
    throw cause;
  }
}

/** Admin-only test helper. It creates one stable sample for every missing demo slot. */
export async function adminFillDemoPlayers(): Promise<Player[]> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { error } = await supabase.rpc("admin_fill_demo_players");
    if (error) throw new Error(error.message);
    return getAllPlayers();
  }
  assertAvailableBackend();
  const players = readLocalPlayers();
  const occupiedSlots = new Set(players.filter((player) => player.isDemo).map((player) => player.demoSlot));
  const createdAt = Date.now();
  let changed = false;
  for (let index = 0; index < DEMO_PLAYER_PROFILES.length; index += 1) {
    const slot = index + 1;
    if (occupiedSlots.has(slot)) continue;
    const [nickname, department] = DEMO_PLAYER_PROFILES[index];
    const id = nextPublicPlayerId(players.map((player) => player.id));
    players.push({
      id,
      nickname,
      department,
      avatarUrl: `/demo-avatars/demo-${String(slot).padStart(2, "0")}.svg`,
      registeredAt: new Date(createdAt + slot).toISOString(),
      status: "waiting",
      isDemo: true,
      demoSlot: slot,
    });
    changed = true;
  }
  if (changed) {
    await persistLocalRosterChange(players);
  }
  return players;
}

/** Removes one roster entry and invalidates any assignments that referenced the old roster. */
export type AdminDeleteResult = { deleted: true; warning?: string };

export function parseSupabaseAvatarPath(
  avatarUrl: string,
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (!configuredUrl || avatarUrl !== avatarUrl.trim() || /[%\\]/.test(avatarUrl)) return null;
  try {
    const source = new URL(avatarUrl);
    const configured = new URL(configuredUrl);
    if (
      source.origin !== configured.origin
      || source.username !== ""
      || source.password !== ""
      || source.search !== ""
      || source.hash !== ""
    ) return null;
    const match = source.pathname.match(
      /^\/storage\/v1\/object\/public\/player-avatars\/pending\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|heic|heif))$/,
    );
    return match ? `pending/${match[1]}` : null;
  } catch {
    return null;
  }
}

export async function adminDeletePlayer(playerId: string): Promise<AdminDeleteResult> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data, error } = await supabase.rpc("admin_delete_player", { p_public_id: playerId });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row?.deleted_public_id) throw new Error("ระบบไม่ได้ยืนยันผลการลบผู้เล่น");
    clearStoredPlayerSessionIfMatches(String(row.deleted_public_id));
    if (!row.deleted_is_demo) {
      const avatarPath = parseSupabaseAvatarPath(String(row.deleted_avatar_url ?? ""));
      if (!avatarPath) {
        return { deleted: true, warning: "ลบผู้เล่นแล้ว แต่ข้ามการลบไฟล์รูป เพราะ URL รูปไม่ตรงกับ Supabase ที่ตั้งค่าไว้" };
      }
      const { error: cleanupError } = await supabase.storage.from("player-avatars").remove([avatarPath]);
      if (cleanupError) {
        return { deleted: true, warning: `ลบผู้เล่นแล้ว แต่ลบไฟล์รูปไม่สำเร็จ: ${cleanupError.message}` };
      }
    }
    return { deleted: true };
  }
  assertAvailableBackend();
  const players = readLocalPlayers();
  if (!players.some((player) => player.id === playerId)) throw new Error("ไม่พบผู้เล่นที่เลือก");
  await persistLocalRosterChange(players.filter((player) => player.id !== playerId));
  clearStoredPlayerSessionIfMatches(playerId);
  return { deleted: true };
}

export type AdminPlayerProfileInput = { nickname: string; department: string };

function cleanAdminPlayerProfile(input: AdminPlayerProfileInput) {
  const nickname = input.nickname.trim();
  const department = input.department.trim();
  if (nickname.length < 2 || nickname.length > 40) {
    throw new Error("ชื่อเล่นต้องมี 2–40 ตัวอักษร");
  }
  if (department.length < 1 || department.length > 80) {
    throw new Error("ฝ่าย/ส่วนงานต้องมี 1–80 ตัวอักษร");
  }
  return { nickname, department };
}

function updateCachedCurrentPlayer(updated: Player) {
  const storedValue = window.localStorage.getItem(PLAYER_STORAGE_KEY);
  if (!storedValue) return;
  const session = parseStoredSession(storedValue);
  const legacyPlayer = parseStoredPlayer(storedValue);
  if (session?.player?.id === updated.id) {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ ...session, player: updated }));
  } else if (!session && legacyPlayer?.id === updated.id) {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(updated));
  }
}

/** Admin-only metadata edit. It intentionally leaves the draw and tournament controls unchanged. */
export async function adminUpdatePlayerProfile(playerId: string, input: AdminPlayerProfileInput): Promise<Player> {
  const profile = cleanAdminPlayerProfile(input);
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data, error } = await supabase.rpc("admin_update_player_profile", {
      p_public_id: playerId,
      p_nickname: profile.nickname,
      p_department: profile.department,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row?.public_id) throw new Error("ระบบไม่ได้ยืนยันผลการแก้ไขผู้เล่น");
    const updated = mapPlayerRow(row);
    try { updateCachedCurrentPlayer(updated); } catch { /* online update succeeded; cache is best effort */ }
    return updated;
  }

  assertAvailableBackend();
  const players = readLocalPlayers();
  const index = players.findIndex((player) => player.id === playerId);
  if (index < 0) throw new Error("ไม่พบผู้เล่นที่เลือก");
  const updated = { ...players[index], ...profile };
  const nextPlayers = [...players];
  nextPlayers[index] = updated;
  const previousRoster = window.localStorage.getItem(PLAYERS_STORAGE_KEY);
  const previousSession = window.localStorage.getItem(PLAYER_STORAGE_KEY);
  try {
    writeLocalPlayers(nextPlayers);
    updateCachedCurrentPlayer(updated);
  } catch (cause) {
    restoreStorageValue(PLAYERS_STORAGE_KEY, previousRoster);
    restoreStorageValue(PLAYER_STORAGE_KEY, previousSession);
    throw cause;
  }
  return updated;
}

function readLocalRecoveryMap() {
  try {
    return JSON.parse(window.localStorage.getItem(RECOVERY_STORAGE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export async function adminIssuePlayerRecoveryCode(playerId: string): Promise<{ playerId: string; recoveryCode: string }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    if (!readLocalPlayers().some((player) => player.id === playerId)) throw new Error("ไม่พบผู้เล่นที่เลือก");
    const recoveryCode = generateRecoveryCode();
    const recoveryMap = readLocalRecoveryMap();
    recoveryMap[playerId] = recoveryCode;
    try {
      window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(recoveryMap));
    } catch (cause) {
      if (isQuotaExceededError(cause)) throw new Error("พื้นที่จัดเก็บไม่พอสำหรับออกรหัสกู้คืน");
      throw cause;
    }
    return { playerId, recoveryCode };
  }
  const { data, error } = await supabase.rpc("admin_issue_player_recovery", { p_public_id: playerId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.recovery_code) throw new Error("ระบบไม่สามารถออกรหัสกู้คืนได้");
  return { playerId: String(row.player_public_id ?? playerId), recoveryCode: String(row.recovery_code) };
}

export async function revealMyOpponent(): Promise<PlayerReveal> {
  const identity = readPlayerIdentity();
  if (!identity) throw new Error("ไม่พบสิทธิ์ผู้เล่นในเครื่องนี้ กรุณาใช้รหัสกู้คืน");
  const state = await getTournamentState();
  if (!state.revealOpen) throw new Error("แอดมินยังไม่เปิดให้ดูคู่แข่ง");
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    const bracket = readLocalBracket(state.version);
    const pair = bracket.matches.filter((item) => item.player1Id === identity.playerId || item.player2Id === identity.playerId)
      .filter((item) => item.status === "ready" || item.status === "bye")
      .sort((left, right) => right.round - left.round)[0];
    if (!pair) throw new Error("ยังไม่พบคู่แข่งขันของคุณ");
    const opponentId = pair.player1Id === identity.playerId ? pair.player2Id : pair.player1Id;
    const opponent = opponentId ? readLocalPlayers().find((player) => player.id === opponentId) ?? null : null;
    return { matchId: pair.id, playerId: identity.playerId, opponent: opponent ? toPublicPlayer(opponent) : null, bye: pair.status === "bye" };
  }
  const { data, error } = await supabase.rpc("reveal_my_opponent", {
    p_public_id: identity.playerId,
    p_identity_token: identity.recoveryCode,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("ยังไม่พบคู่แข่งขันของคุณ");
  const opponent = row.opponent_public_id ? {
    id: String(row.opponent_public_id),
    nickname: String(row.opponent_nickname),
    department: String(row.opponent_department),
    avatarUrl: String(row.opponent_avatar_url),
  } : null;
  return { matchId: String(row.match_id), playerId: identity.playerId, opponent, bye: Boolean(row.is_bye) };
}

export async function adminSignIn(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) { assertAvailableBackend(); return; }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const { data: adminById } = await supabase.from("admin_users").select("user_id").maybeSingle();
  const { data: adminByEmail } = await supabase.from("admin_emails").select("email").maybeSingle();
  if (!adminById && !adminByEmail) {
    await supabase.auth.signOut();
    throw new Error("บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลการแข่งขัน");
  }
}

export async function getAdminSession(): Promise<AdminSessionState> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    const demo = isLocalDemoEnabled();
    return { active: demo, demo, configurationError: !demo };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { active: false, demo: false, configurationError: false };
  const { data: adminById } = await supabase.from("admin_users").select("user_id").maybeSingle();
  const { data: adminByEmail } = await supabase.from("admin_emails").select("email").maybeSingle();
  return { active: Boolean(adminById || adminByEmail), demo: false, configurationError: false };
}

export async function adminSignOut() {
  const supabase = getSupabaseBrowserClient();
  if (supabase) await supabase.auth.signOut();
}

export function onlineModeLabel() {
  if (isSupabaseConfigured()) return "SUPABASE LIVE";
  return isLocalDemoEnabled() ? "LOCAL DEMO" : "SETUP REQUIRED";
}
