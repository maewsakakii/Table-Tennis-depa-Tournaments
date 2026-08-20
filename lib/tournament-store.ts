"use client";

import { generateRecoveryCode, nextPublicPlayerId, normalizeRecoveryCode } from "./player-identity.ts";
import type {
  AdminDraw,
  HiddenMatchPair,
  Player,
  PlayerIdentity,
  PlayerRegistration,
  PlayerReveal,
  PublicPlayer,
  TournamentState,
} from "./types.ts";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "./supabase.ts";
import { compressAvatarForLocalStorage } from "./local-avatar.ts";

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
    .select("public_id,nickname,department,email,avatar_url,registered_at")
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

export async function generateHiddenAssignments(): Promise<AdminDraw> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    assertAvailableBackend();
    const ids = shuffleIds(readLocalPlayers().map((player) => player.id));
    const current = await getTournamentState();
    const version = current.version + 1;
    const pairs: HiddenMatchPair[] = [];
    for (let index = 0; index < ids.length; index += 2) {
      pairs.push({ id: crypto.randomUUID(), player1Id: ids[index], player2Id: ids[index + 1] ?? null });
    }
    const draw = { version, pairs };
    const nextState: TournamentState = {
      version,
      status: "locked",
      registrationOpen: false,
      revealOpen: false,
      startedAt: new Date().toISOString(),
    };
    // Replace legacy avatar-heavy public state before writing even the small hidden draw.
    await saveTournamentState(nextState);
    const serializedDraw = JSON.stringify(draw);
    try {
      window.localStorage.setItem(DRAW_STORAGE_KEY, serializedDraw);
    } catch (cause) {
      if (!isQuotaExceededError(cause)) throw cause;
      window.localStorage.removeItem(DRAW_STORAGE_KEY);
      try {
        window.localStorage.setItem(DRAW_STORAGE_KEY, serializedDraw);
      } catch (retryCause) {
        await saveTournamentState(current);
        if (!isQuotaExceededError(retryCause)) throw retryCause;
        throw new Error("พื้นที่จัดเก็บไม่พอสำหรับบันทึกผลจับคู่ กรุณาล้างข้อมูล Local Demo แล้วลองอีกครั้ง");
      }
    }
    return draw;
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
      const draw = JSON.parse(window.localStorage.getItem(DRAW_STORAGE_KEY) ?? "null") as AdminDraw | null;
      return draw ?? { version: expectedVersion ?? 0, pairs: [] };
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

export async function updateTournamentControls(changes: Partial<Pick<TournamentState, "registrationOpen" | "revealOpen">>) {
  const current = await getTournamentState();
  const candidate = { ...current, ...changes };
  assertValidTournamentState(candidate);
  const next = compactTournamentState(candidate);
  await saveTournamentState(next);
  return next;
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
    const draw = await getAdminDraw(state.version);
    const pair = draw.pairs.find((item) => item.player1Id === identity.playerId || item.player2Id === identity.playerId);
    if (!pair) throw new Error("ยังไม่พบคู่แข่งขันของคุณ");
    const opponentId = pair.player1Id === identity.playerId ? pair.player2Id : pair.player1Id;
    const opponent = opponentId ? readLocalPlayers().find((player) => player.id === opponentId) ?? null : null;
    return { matchId: pair.id, playerId: identity.playerId, opponent: opponent ? toPublicPlayer(opponent) : null, bye: !opponentId };
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
