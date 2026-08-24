import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMatchHistory,
  generateDivisionalBrackets,
  generateKnockoutBracket,
  recordBracketScore,
} from "./bracket.ts";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `DT-${String(index + 1).padStart(2, "0")}`);

test("builds a complete knockout topology for every supported roster size", () => {
  for (let count = 2; count <= 64; count += 1) {
    const bracket = generateKnockoutBracket(ids(count), 7, (values) => values);
    const size = 2 ** Math.ceil(Math.log2(count));
    assert.equal(bracket.matches.length, size - 1, `count=${count}`);
    assert.equal(bracket.roundCount, Math.log2(size), `count=${count}`);
    assert.equal(new Set(bracket.matches.map((match) => match.id)).size, size - 1);
    assert.equal(bracket.matches.filter((match) => match.round === bracket.roundCount).length, 1);
  }
});

test("distributes fourteen entrants 3-4-4-3 across quarter blocks", () => {
  const bracket = generateKnockoutBracket(ids(14), 1, (values) => values);
  const firstRound = bracket.matches.filter((match) => match.round === 1);
  const quarterCounts = [0, 1, 2, 3].map((quarter) => firstRound
    .slice(quarter * 2, quarter * 2 + 2)
    .reduce((count, match) => count + Number(Boolean(match.player1Id)) + Number(Boolean(match.player2Id)), 0));
  assert.deepEqual(quarterCounts, [3, 4, 4, 3]);
});

test("places every entrant once and never creates a double-empty first-round match", () => {
  for (let count = 2; count <= 64; count += 1) {
    const bracket = generateKnockoutBracket(ids(count), 1, (values) => values);
    const firstRound = bracket.matches.filter((match) => match.round === 1);
    const placed = firstRound.flatMap((match) => [match.player1Id, match.player2Id]).filter(Boolean);
    assert.equal(new Set(placed).size, count, `count=${count}`);
    assert.equal(placed.length, count, `count=${count}`);
    assert.ok(firstRound.every((match) => match.player1Id || match.player2Id), `count=${count}`);
  }
});

test("marks every later match filled by adjacent BYEs as ready", () => {
  for (const count of [5, 9, 10, 11, 17, 23, 33, 47]) {
    const bracket = generateKnockoutBracket(ids(count), 1, (values) => values);
    assert.ok(bracket.matches.every((match) => {
      if (match.player1Id && match.player2Id) return match.status === "ready";
      return true;
    }), `count=${count}`);
  }
});

test("rejects a shuffle that substitutes an entrant", () => {
  assert.throws(
    () => generateKnockoutBracket(ids(4), 1, (values) => ["DT-99", ...values.slice(1)]),
    /ผลการสุ่ม/,
  );
});

test("automatically advances a bye without counting it as played history", () => {
  const bracket = generateKnockoutBracket(ids(3), 1, (values) => values);
  const bye = bracket.matches.find((match) => match.status === "bye")!;
  const next = bracket.matches.find((match) => match.id === bye.nextMatchId)!;
  assert.equal(next[bye.nextSlot === 1 ? "player1Id" : "player2Id"], bye.winnerId);
  assert.deepEqual(deriveMatchHistory(bracket, bye.winnerId!), []);
});

test("records scores, advances winners, rejects stale/tied/invalid scores, and derives history", () => {
  let bracket = generateKnockoutBracket(ids(4), 3, (values) => values);
  const first = bracket.matches.find((match) => match.round === 1 && match.position === 0)!;
  bracket = recordBracketScore(bracket, first.id, 11, 8, first.revision);
  const completed = bracket.matches.find((match) => match.id === first.id)!;
  assert.equal(completed.winnerId, first.player1Id);
  assert.equal(completed.revision, 1);
  const next = bracket.matches.find((match) => match.id === completed.nextMatchId)!;
  assert.equal(next.player1Id, first.player1Id);
  assert.equal(next.revision, 1);
  assert.deepEqual(deriveMatchHistory(bracket, first.player1Id!), [{
    matchId: first.id, round: 1, opponentId: first.player2Id!, scoreFor: 11, scoreAgainst: 8,
  }]);
  assert.throws(() => recordBracketScore(bracket, first.id, 11, 9, 0), /stale/i);
  assert.throws(() => recordBracketScore(bracket, first.id, 8, 8, 1), /เสมอ/);
  assert.throws(() => recordBracketScore(bracket, first.id, 100, 8, 1), /0–99/);
});

test("allows a correction before the downstream match completes and blocks it afterwards", () => {
  let bracket = generateKnockoutBracket(ids(4), 2, (values) => values);
  const semiA = bracket.matches.find((match) => match.round === 1 && match.position === 0)!;
  const semiB = bracket.matches.find((match) => match.round === 1 && match.position === 1)!;
  bracket = recordBracketScore(bracket, semiA.id, 11, 5, 0);
  const staleFinalRevision = bracket.matches.find((match) => match.round === 2)!.revision;
  bracket = recordBracketScore(bracket, semiA.id, 7, 11, 1);
  let final = bracket.matches.find((match) => match.round === 2)!;
  assert.equal(final.player1Id, semiA.player2Id);
  assert.notEqual(final.revision, staleFinalRevision);
  bracket = recordBracketScore(bracket, semiB.id, 11, 4, 0);
  final = bracket.matches.find((match) => match.round === 2)!;
  bracket = recordBracketScore(bracket, final.id, 11, 9, final.revision);
  assert.throws(() => recordBracketScore(bracket, semiA.id, 11, 2, 2), /รอบถัดไป/);
});

test("divisional draw builds two independent brackets that never share a match", () => {
  const bracket = generateDivisionalBrackets(
    { male: ["DT-01", "DT-02", "DT-03"], female: ["DT-04", "DT-05"] },
    9,
    (values) => values,
  );
  const male = bracket.matches.filter((match) => match.division === "male");
  const female = bracket.matches.filter((match) => match.division === "female");
  assert.equal(male.length, 3);   // 3 players -> bracket of 4 -> 3 matches
  assert.equal(female.length, 1); // 2 players -> one final
  assert.equal(bracket.roundCount, 2);
  // Match ids are unique across divisions, and no match points into the other division.
  assert.equal(new Set(bracket.matches.map((match) => match.id)).size, bracket.matches.length);
  const ids = new Map(bracket.matches.map((match) => [match.id, match.division]));
  for (const match of bracket.matches) {
    if (match.nextMatchId) assert.equal(ids.get(match.nextMatchId), match.division);
  }
  // No male player id ever appears in a female match and vice versa.
  const maleIds = new Set(["DT-01", "DT-02", "DT-03"]);
  for (const match of female) {
    assert.equal(maleIds.has(match.player1Id ?? ""), false);
    assert.equal(maleIds.has(match.player2Id ?? ""), false);
  }
});
