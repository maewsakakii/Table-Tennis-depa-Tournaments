import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compactTournamentState,
  adminDeletePlayer,
  adminFillDemoPlayers,
  adminIssuePlayerRecoveryCode,
  generateHiddenAssignments,
  getAdminDraw,
  getAdminSession,
  getAllPlayers,
  getTournamentState,
  initialTournamentState,
  isLocalDemoEnabled,
  readPlayerIdentity,
  readSavedPlayer,
  restoreSavedPlayerSession,
  parseSupabaseAvatarPath,
  PLAYER_STORAGE_KEY,
  revealMyOpponent,
  restorePlayerWithRecoveryCode,
  saveLocalPlayer,
  saveTournamentState,
  updateTournamentControls,
} from "./tournament-store.ts";
import type { Player, TournamentState } from "./types.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class QuotaStorage extends MemoryStorage {
  private quota: number;
  constructor(quota: number) { super(); this.quota = quota; }
  setQuota(quota: number) { this.quota = quota; }
  get used() {
    let total = 0;
    for (let index = 0; index < this.length; index += 1) {
      const key = this.key(index) ?? "";
      total += key.length + (this.getItem(key)?.length ?? 0);
    }
    return total;
  }
  override setItem(key: string, value: string) {
    const previous = this.getItem(key);
    super.setItem(key, value);
    if (this.used > this.quota) {
      if (previous === null) this.removeItem(key);
      else super.setItem(key, previous);
      throw new DOMException("Setting the value exceeded the quota", "QuotaExceededError");
    }
  }
}

test("public tournament state strips legacy roster, pairs, and data URLs", () => {
  const compact = compactTournamentState({
    version: 4,
    status: "ready",
    roster: [{ id: "DT-01", avatarUrl: "data:image/jpeg;base64,large" }],
    pairs: [{ player1: { id: "DT-01" }, player2: { id: "DT-02" } }],
    startedAt: "2026-08-20T00:00:00.000Z",
  });

  assert.deepEqual(compact, {
    version: 4,
    status: "locked",
    registrationOpen: false,
    revealOpen: true,
    startedAt: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(compact).includes("pairs"), false);
  assert.equal(JSON.stringify(compact).includes("data:image"), false);
});

test("local tournament state is compact and backward-compatible", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  storage.setItem("office-smash-tournament-state", JSON.stringify({
    version: 2,
    status: "drawing",
    roster: [{ id: "DT-01", avatarUrl: "data:image/png;base64,huge" }],
    pairs: [{ id: "pair", player1: { id: "DT-01" }, player2: { id: "DT-02" } }],
  }));

  assert.deepEqual(await getTournamentState(), {
    version: 2,
    status: "locked",
    registrationOpen: false,
    revealOpen: false,
    startedAt: null,
  });

  const next: TournamentState = { ...initialTournamentState, version: 3, registrationOpen: false };
  await saveTournamentState(next);
  const serialized = storage.getItem("office-smash-tournament-state") ?? "";
  assert.equal(serialized.includes("roster"), false);
  assert.equal(serialized.includes("pairs"), false);
  assert.equal(serialized.includes("data:image"), false);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("local demo requires an explicit flag and can never activate in production", async () => {
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
  assert.equal(isLocalDemoEnabled("development", undefined), false);
  assert.deepEqual(await getAdminSession(), { active: false, demo: false, configurationError: true });

  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  assert.equal(isLocalDemoEnabled("development", "true"), true);
  assert.deepEqual(await getAdminSession(), { active: true, demo: true, configurationError: false });

  assert.equal(isLocalDemoEnabled("production", "true"), false);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("a player reveal is idempotent and returns only that player's assigned opponent", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const makePlayer = (id: string, nickname: string): Player => ({
    id,
    nickname,
    department: "Digital",
    avatarUrl: `https://example.test/${id}.jpg`,
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  });
  const first = makePlayer("DT-01", "หนึ่ง");
  const second = makePlayer("DT-02", "สอง");
  saveLocalPlayer(second);
  saveLocalPlayer(first, "DT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF");

  const draw = await generateHiddenAssignments();
  assert.equal(draw.pairs.length, 1);
  assert.equal(JSON.stringify(draw).includes("avatarUrl"), false);
  await updateTournamentControls({ revealOpen: true });

  const firstReveal = await revealMyOpponent();
  const repeatedReveal = await revealMyOpponent();
  assert.deepEqual(repeatedReveal, firstReveal);
  assert.equal(firstReveal.playerId, "DT-01");
  assert.equal(firstReveal.opponent?.id, "DT-02");
  assert.deepEqual(Object.keys(firstReveal.opponent ?? {}).sort(), ["avatarUrl", "department", "id", "nickname"]);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("the first local draw compacts a quota-heavy legacy state before storing hidden IDs", async () => {
  const storage = new QuotaStorage(30_000);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const player = (id: string): Player => ({
    id,
    nickname: id,
    department: "Digital",
    avatarUrl: `https://example.test/${id}.jpg`,
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  });
  saveLocalPlayer(player("DT-01"));
  saveLocalPlayer(player("DT-02"), "DT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF");
  const stateKey = "office-smash-tournament-state";
  const fixedLegacy = JSON.stringify({ version: 0, status: "registration", roster: [{ avatarUrl: "" }], pairs: [] });
  const roomBeforeLegacy = 30_000 - storage.used - stateKey.length;
  storage.setItem(stateKey, fixedLegacy.replace('""', `"data:image/jpeg;base64,${"x".repeat(roomBeforeLegacy - fixedLegacy.length - 80)}"`));
  assert.ok(30_000 - storage.used < 100);

  const draw = await generateHiddenAssignments();
  assert.equal(draw.pairs.length, 1);
  assert.equal((storage.getItem(stateKey) ?? "").includes("data:image"), false);
  assert.equal((storage.getItem("office-smash-hidden-draw") ?? "").includes("avatar"), false);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("local draw reports a friendly error when compact ID state still cannot fit", async () => {
  const storage = new QuotaStorage(30_000);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const makePlayer = (id: string): Player => ({
    id, nickname: id, department: "D", avatarUrl: `https://example.test/${id}.jpg`,
    registeredAt: "2026-08-20T00:00:00.000Z", status: "waiting",
  });
  saveLocalPlayer(makePlayer("DT-01"));
  saveLocalPlayer(makePlayer("DT-02"), "DT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF");
  storage.setQuota(storage.used + 250);

  await assert.rejects(() => generateHiddenAssignments(), /พื้นที่จัดเก็บไม่พอสำหรับบันทึกผลจับคู่/);
  assert.equal(storage.getItem("office-smash-hidden-draw"), null);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("invalid tournament control combinations are rejected before persistence", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  await assert.rejects(
    () => updateTournamentControls({ registrationOpen: false, revealOpen: true }),
    /ต้องสุ่มและล็อกคู่/,
  );
  await assert.rejects(
    () => saveTournamentState({ version: 1, status: "locked", registrationOpen: true, revealOpen: true, startedAt: null }),
    /เปิดรับสมัครพร้อมกับเปิดเผยคู่/,
  );
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("an admin can issue a one-time recovery code for a legacy local player", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const legacy: Player = {
    id: "DT-01", nickname: "Legacy", department: "Digital",
    avatarUrl: "https://example.test/DT-01.jpg",
    registeredAt: "2026-08-20T00:00:00.000Z", status: "waiting",
  };
  saveLocalPlayer(legacy);
  const issued = await adminIssuePlayerRecoveryCode("DT-01");
  assert.equal(issued.playerId, "DT-01");
  assert.match(issued.recoveryCode, /^DT-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){5}$/);
  assert.deepEqual(await restorePlayerWithRecoveryCode(issued.recoveryCode), legacy);
  assert.deepEqual(readPlayerIdentity(), { playerId: "DT-01", recoveryCode: issued.recoveryCode });
  assert.deepEqual(readSavedPlayer(), legacy);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("local admin fills exactly ten stable demo slots without colliding with real DT IDs", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const realPlayer: Player = {
    id: "DT-01", nickname: "ตัวจริง", department: "Digital",
    avatarUrl: "https://example.test/real.jpg", registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting", isDemo: false, demoSlot: null,
  };
  saveLocalPlayer(realPlayer);

  const first = await adminFillDemoPlayers();
  const repeated = await adminFillDemoPlayers();
  assert.equal(first.filter((player) => player.isDemo).length, 10);
  assert.equal(repeated.filter((player) => player.isDemo).length, 10);
  assert.equal(repeated.length, 11);
  assert.equal(new Set(repeated.map((player) => player.id)).size, 11);
  assert.deepEqual(repeated.filter((player) => player.isDemo).map((player) => player.demoSlot), [1,2,3,4,5,6,7,8,9,10]);
  assert.ok(repeated.filter((player) => player.isDemo).every((player) => /^\/demo-avatars\/demo-\d{2}\.svg$/.test(player.avatarUrl)));
  assert.equal(readSavedPlayer()?.id, realPlayer.id, "admin test data must not replace the browser's player session");
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("opening registration invalidates an older local draw", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  await adminFillDemoPlayers();
  const draw = await generateHiddenAssignments();
  await updateTournamentControls({ revealOpen: true });

  const reopened = await updateTournamentControls({ registrationOpen: true, revealOpen: false });
  assert.equal(reopened.status, "registration");
  assert.equal(reopened.registrationOpen, true);
  assert.equal(reopened.revealOpen, false);
  assert.equal((await getAdminDraw()).pairs.length, 0);
  assert.ok(reopened.version > draw.version);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("saved recovery identity is revalidated while a legacy session remains backward-compatible", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const player: Player = {
    id: "DT-01", nickname: "ผู้เล่นเก่า", department: "Digital",
    avatarUrl: "/demo-avatars/demo-01.svg", registeredAt: "2026-08-20T00:00:00.000Z", status: "waiting",
  };

  saveLocalPlayer(player);
  assert.deepEqual(await restoreSavedPlayerSession(), player, "legacy sessions without recovery codes must remain usable");

  saveLocalPlayer(player, "DT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF");
  storage.setItem("office-smash-players", "[]");
  assert.equal(await restoreSavedPlayerSession(), null);
  assert.equal(storage.getItem(PLAYER_STORAGE_KEY), null, "a deleted identity must not stay in Lobby");

  saveLocalPlayer(player);
  storage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ playerId: player.id, recoveryCode: "corrupt-code" }));
  assert.equal(await restoreSavedPlayerSession(), null);
  assert.equal(storage.getItem(PLAYER_STORAGE_KEY), null, "a malformed identity must be cleared");
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("Supabase avatar cleanup accepts only an exact pending object URL", () => {
  const origin = "https://project-ref.supabase.co";
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  const valid = `${origin}/storage/v1/object/public/player-avatars/pending/${uuid}.jpg`;
  assert.equal(parseSupabaseAvatarPath(valid, origin), `pending/${uuid}.jpg`);
  for (const unsafe of [
    `${valid}?download=1`,
    `${valid}#fragment`,
    `https://user:pass@project-ref.supabase.co/storage/v1/object/public/player-avatars/pending/${uuid}.jpg`,
    `https://evil.example/storage/v1/object/public/player-avatars/pending/${uuid}.jpg`,
    `${origin}/storage/v1/object/public/player-avatars/other/${uuid}.jpg`,
    `${origin}/storage/v1/object/public/player-avatars/pending/not-a-uuid.jpg`,
    `${origin}/storage/v1/object/public/player-avatars/pending/%2e%2e/${uuid}.jpg`,
    `${origin}/storage/v1/object/public/player-avatars/pending/${uuid}.svg`,
  ]) assert.equal(parseSupabaseAvatarPath(unsafe, origin), null, unsafe);
});

test("deleting a player clears the hidden draw, closes reveal, and refill restores only the missing demo slot", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const filled = await adminFillDemoPlayers();
  const draw = await generateHiddenAssignments();
  assert.equal(draw.pairs.length, 5);
  await updateTournamentControls({ revealOpen: true });

  const deleted = filled.find((player) => player.demoSlot === 4)!;
  await adminDeletePlayer(deleted.id);
  const clearedDraw = await getAdminDraw();
  const afterDelete = await getAllPlayers();
  const state = await getTournamentState();
  assert.equal(clearedDraw.pairs.length, 0);
  assert.equal(afterDelete.filter((player) => player.isDemo).length, 9);
  assert.equal(state.revealOpen, false);
  assert.equal(state.registrationOpen, false);

  const refilled = await adminFillDemoPlayers();
  assert.equal(refilled.filter((player) => player.isDemo).length, 10);
  assert.equal(refilled.filter((player) => player.demoSlot === 4).length, 1);
  assert.notEqual(refilled.find((player) => player.demoSlot === 4)?.id, deleted.id);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("deleting a legacy direct-JSON player clears its pointer so it cannot rehydrate", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  });
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = "true";
  const legacy: Player = {
    id: "DT-07", nickname: "Legacy JSON", department: "Digital",
    avatarUrl: "/demo-avatars/demo-07.svg", registeredAt: "2026-08-20T00:00:00.000Z", status: "waiting",
  };
  storage.setItem("office-smash-players", JSON.stringify([legacy]));
  storage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(legacy));

  await adminDeletePlayer(legacy.id);
  assert.equal(storage.getItem(PLAYER_STORAGE_KEY), null);
  assert.deepEqual(await getAllPlayers(), []);
  assert.equal(readSavedPlayer(), null);
  delete process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO;
});

test("migration serializes registration/draw, validates controls and avatar origin, and protects recovery rotation", () => {
  const baseSql = readFileSync(new URL("../supabase/migrations/001_office_smash.sql", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/003_hidden_draw_and_player_identity.sql", import.meta.url), "utf8");
  assert.match(baseSql, /create schema if not exists extensions[\s\S]*pgcrypto with schema extensions/i);
  assert.match(baseSql, /alter extension pgcrypto set schema extensions/i);
  assert.match(sql, /register_player[\s\S]*tournament_state[\s\S]*for update/i);
  assert.match(sql, /admin_generate_hidden_draw[\s\S]*for update[\s\S]*array_agg/i);
  assert.match(sql, /admin_issue_player_recovery/i);
  assert.match(sql, /gen_random_bytes\s*\(\s*15\s*\)/i);
  assert.match(sql, /registration_open[\s\S]*reveal_open[\s\S]*check/i);
  assert.match(sql, /admin_update_tournament_controls[\s\S]*private_matches[\s\S]*draw_version/i);
  assert.match(sql, /player-avatars\/pending\//i);
  assert.match(sql, /storage\.objects[\s\S]*bucket_id[\s\S]*avatar_object_name/i);
  assert.match(sql, /players_avatar_url_unique/i);
  assert.match(sql, /revoke all on function public\.admin_issue_player_recovery/i);
  const rosterSql = readFileSync(new URL("../supabase/migrations/004_admin_demo_roster_tools.sql", import.meta.url), "utf8");
  assert.match(rosterSql, /add column if not exists is_demo boolean/i);
  assert.match(rosterSql, /demo_slot[\s\S]*between 1 and 10/i);
  assert.match(rosterSql, /admin_fill_demo_players[\s\S]*is_tournament_admin/i);
  assert.match(rosterSql, /admin_delete_player[\s\S]*is_tournament_admin/i);
  assert.match(rosterSql, /delete from public\.private_matches/i);
  assert.match(rosterSql, /if p_registration_open and not current_state\.registration_open then[\s\S]*delete from public\.private_matches/i);
});

test("admin roster UI keeps demo tools visible, warns before delete, and omits the removed subtitle", () => {
  const ui = readFileSync(new URL("../components/admin-experience.tsx", import.meta.url), "utf8");
  const registrationUi = readFileSync(new URL("../components/registration-experience.tsx", import.meta.url), "utf8");
  assert.match(ui, /เติมผู้เล่น Demo ให้ครบ 10 คน/);
  assert.match(ui, /การลบจะยกเลิกผลจับคู่เดิม/);
  assert.match(ui, /DEMO/);
  assert.doesNotMatch(ui, /ล็อกคู่ไว้หลังบ้าน แล้วเปิดให้นักแข่งสุ่มดูคู่ของตัวเองเมื่อพร้อม/);
  assert.match(registrationUi, /restoreSavedPlayerSession/);
});
