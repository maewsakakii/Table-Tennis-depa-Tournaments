import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compactTournamentState,
  adminIssuePlayerRecoveryCode,
  generateHiddenAssignments,
  getAdminSession,
  getTournamentState,
  initialTournamentState,
  isLocalDemoEnabled,
  readPlayerIdentity,
  readSavedPlayer,
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
});
