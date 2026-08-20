import assert from "node:assert/strict";
import test from "node:test";

import { compressAvatarForLocalStorage, isAcceptedAvatar } from "./local-avatar.ts";
import { cacheOnlinePlayer, PLAYER_STORAGE_KEY, readSavedPlayer, saveLocalPlayer } from "./tournament-store.ts";
import type { Player } from "./types.ts";

const PLAYERS_STORAGE_KEY = "office-smash-players";

class QuotaStorage implements Storage {
  private readonly values = new Map<string, string>();
  private readonly quota: number;

  constructor(quota: number) { this.quota = quota; }

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    const next = new Map(this.values);
    next.set(key, value);
    const used = [...next].reduce((total, [storedKey, storedValue]) => total + storedKey.length + storedValue.length, 0);
    if (used > this.quota) throw new DOMException("Setting the value exceeded the quota", "QuotaExceededError");
    this.values.set(key, value);
  }
}

test("local registration does not duplicate a large mobile avatar across storage keys", () => {
  const storage = new QuotaStorage(5_000_000);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  const player: Player = {
    id: "mobile-player",
    nickname: "ตัวตึง",
    department: "Digital",
    avatarUrl: `data:image/jpeg;base64,${"a".repeat(3_000_000)}`,
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  };

  assert.doesNotThrow(() => saveLocalPlayer(player));
  assert.ok(storage.getItem(PLAYERS_STORAGE_KEY)?.includes(player.avatarUrl));
  assert.equal(storage.getItem(PLAYER_STORAGE_KEY), JSON.stringify({ playerId: player.id }));
  assert.deepEqual(readSavedPlayer(), player);
});

test("recovery identity stays compact and does not duplicate a local avatar", () => {
  const storage = new QuotaStorage(5_000_000);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  const player: Player = {
    id: "DT-01",
    nickname: "ตัวตึง",
    department: "Digital",
    avatarUrl: `data:image/jpeg;base64,${"r".repeat(3_000_000)}`,
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  };

  assert.doesNotThrow(() => saveLocalPlayer(player, "DT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF"));
  assert.equal(storage.getItem(PLAYER_STORAGE_KEY), JSON.stringify({
    playerId: "DT-01",
    recoveryCode: "DT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
  }));
  assert.deepEqual(readSavedPlayer(), player);
});

test("local registration clears duplicated tournament state and retries when storage is already pressured", () => {
  const storage = new QuotaStorage(5_000_000);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  storage.setItem("office-smash-tournament-state", "x".repeat(2_200_000));
  const player: Player = {
    id: "quota-recovery-player",
    nickname: "แชมป์",
    department: "Strategy",
    avatarUrl: `data:image/jpeg;base64,${"b".repeat(3_000_000)}`,
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  };

  assert.doesNotThrow(() => saveLocalPlayer(player));
  assert.equal(storage.getItem("office-smash-tournament-state"), null);
  assert.deepEqual(readSavedPlayer(), player);
});

test("successful online registration treats a quota-full local cache as best effort", () => {
  const storage = new QuotaStorage(200);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  storage.setItem(PLAYER_STORAGE_KEY, "x".repeat(170));
  const player: Player = {
    id: "online-player",
    nickname: "Online",
    department: "Cloud",
    avatarUrl: "https://example.supabase.co/storage/avatar.jpg",
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  };

  assert.doesNotThrow(() => cacheOnlinePlayer(player));
});

test("failed mobile HEIC decoding never falls back to its unbounded original data URL", async () => {
  const original = `data:image/heic;base64,${"h".repeat(6_000_000)}`;
  const file = new File([new Uint8Array(5_000_000)], "portrait.heic", { type: "image/heic" });

  const compressed = await compressAvatarForLocalStorage(file, original);

  assert.notEqual(compressed, original);
  assert.ok(compressed.startsWith("data:image/"));
  assert.ok(compressed.length < 10_000);
});

test("failed local registration rolls back the player pointer and tournament state", () => {
  const storage = new QuotaStorage(5_000_000);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  const priorPlayer = JSON.stringify({ id: "prior", nickname: "Prior", avatarUrl: "data:image/jpeg;base64,old" });
  const priorState = JSON.stringify({ version: 7, status: "ready" });
  storage.setItem(PLAYER_STORAGE_KEY, priorPlayer);
  storage.setItem("office-smash-tournament-state", priorState);
  const player: Player = {
    id: "too-large",
    nickname: "Huge",
    department: "Mobile",
    avatarUrl: `data:image/jpeg;base64,${"z".repeat(5_100_000)}`,
    registeredAt: "2026-08-20T00:00:00.000Z",
    status: "waiting",
  };

  assert.throws(() => saveLocalPlayer(player), /พื้นที่จัดเก็บ/);
  assert.equal(storage.getItem(PLAYER_STORAGE_KEY), priorPlayer);
  assert.equal(storage.getItem("office-smash-tournament-state"), priorState);
});

test("avatar validation rejects unsupported or mismatched MIME types", () => {
  assert.equal(isAcceptedAvatar(new File(["svg"], "portrait.png", { type: "image/svg+xml" })), false);
  assert.equal(isAcceptedAvatar(new File(["png"], "portrait.jpg", { type: "image/png" })), false);
  assert.equal(isAcceptedAvatar(new File(["heic"], "portrait.heic", { type: "" })), true);
  assert.equal(isAcceptedAvatar(new File(["jpeg"], "camera.jpg", { type: "image/jpeg" })), true);
});
