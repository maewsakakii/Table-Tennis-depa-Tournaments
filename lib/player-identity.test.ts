import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPublicPlayerId,
  generateRecoveryCode,
  nextPublicPlayerId,
  normalizeRecoveryCode,
} from "./player-identity.ts";

test("public player IDs use the DT prefix with a two-digit minimum", () => {
  assert.equal(formatPublicPlayerId(1), "DT-01");
  assert.equal(formatPublicPlayerId(9), "DT-09");
  assert.equal(formatPublicPlayerId(10), "DT-10");
  assert.equal(formatPublicPlayerId(100), "DT-100");
});

test("local player IDs continue after the highest valid DT sequence", () => {
  assert.equal(nextPublicPlayerId(["DT-02", "legacy-id", "DT-09"]), "DT-10");
  assert.equal(nextPublicPlayerId(["DT-99", "DT-100"]), "DT-101");
});

test("recovery codes are human-readable but retain at least 120 bits of entropy", () => {
  const bytes = Uint8Array.from({ length: 15 }, (_, index) => index);
  const code = generateRecoveryCode(bytes);

  assert.match(code, /^DT-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){5}$/);
  assert.equal(normalizeRecoveryCode(code.toLowerCase().replaceAll("-", " ")), code);
  assert.equal(
    normalizeRecoveryCode("dt rcv abcde 12345 fedcb 67890 abcde 12345"),
    "DT-RCV-ABCDE-12345-FEDCB-67890-ABCDE-12345",
  );
  assert.equal(normalizeRecoveryCode("DT-INVALID"), null);
});
