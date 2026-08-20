import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBracketRounds, futureSourceLabel } from "./bracket-ui.ts";
import type { TournamentSnapshot } from "./types.ts";

const snapshot: TournamentSnapshot = {
  version: 2,
  bracketRevision: 0,
  roundCount: 3,
  players: [],
  matches: [
    ...Array.from({ length: 4 }, (_, position) => ({
      id: `r1-${position}`, version: 2, round: 1, position,
      player1Id: `DT-${position * 2 + 1}`, player2Id: `DT-${position * 2 + 2}`,
      source1MatchId: null, source2MatchId: null, nextMatchId: `r2-${Math.floor(position / 2)}`,
      nextSlot: position % 2 === 0 ? 1 as const : 2 as const,
      score1: null, score2: null, winnerId: null, status: "ready" as const, revision: 0,
    })),
    ...Array.from({ length: 2 }, (_, position) => ({
      id: `r2-${position}`, version: 2, round: 2, position,
      player1Id: null, player2Id: null,
      source1MatchId: `r1-${position * 2}`, source2MatchId: `r1-${position * 2 + 1}`,
      nextMatchId: "r3-0", nextSlot: position === 0 ? 1 as const : 2 as const,
      score1: null, score2: null, winnerId: null, status: "waiting" as const, revision: 0,
    })),
    {
      id: "r3-0", version: 2, round: 3, position: 0,
      player1Id: null, player2Id: null, source1MatchId: "r2-0", source2MatchId: "r2-1",
      nextMatchId: null, nextSlot: null, score1: null, score2: null,
      winnerId: null, status: "waiting", revision: 0,
    },
  ],
};

test("mobile bracket presents every knockout round in order", () => {
  const rounds = buildBracketRounds(snapshot);
  assert.deepEqual(rounds.map((round) => round.round), [1, 2, 3]);
  assert.deepEqual(rounds.map((round) => round.matches.length), [4, 2, 1]);
  assert.deepEqual(rounds.map((round) => round.label), ["รอบแรก", "รอบรองชนะเลิศ", "รอบชิงชนะเลิศ"]);
});

test("future slots name the source match rather than looking empty", () => {
  assert.equal(futureSourceLabel(snapshot, "r1-2"), "ผู้ชนะคู่ 3 · รอบแรก");
  assert.equal(futureSourceLabel(snapshot, null), "รอผลการแข่งขัน");
});

test("the mobile bracket highlights the player's entire future route", () => {
  const component = readFileSync(new URL("../components/tournament-bracket.tsx", import.meta.url), "utf8");
  assert.match(component, /while \(match\)[\s\S]*path\.add\(match\.id\)[\s\S]*match\.nextMatchId/);
  assert.match(component, /onPath=\{playerPath\.has\(match\.id\)\}/);
});
