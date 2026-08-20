import type { BracketMatch, KnockoutBracket, MatchHistoryEntry } from "./types.ts";

export type ShufflePlayers = (playerIds: string[]) => string[];

function bracketSizeFor(count: number) {
  return 2 ** Math.ceil(Math.log2(count));
}

function matchId(version: number, round: number, position: number) {
  return `v${version}-r${round}-m${position}`;
}

function byeMatchIndexes(matchCount: number, byeCount: number) {
  if (byeCount <= 0) return new Set<number>();
  if (byeCount === 1) return new Set([0]);
  return new Set(Array.from(
    { length: byeCount },
    (_, index) => Math.round(index * (matchCount - 1) / (byeCount - 1)),
  ));
}

/** Pure, deterministic topology builder when a deterministic shuffle is supplied. */
export function generateKnockoutBracket(
  inputPlayerIds: string[],
  version: number,
  shuffle: ShufflePlayers,
): KnockoutBracket {
  if (inputPlayerIds.length < 2 || inputPlayerIds.length > 64) {
    throw new Error("จำนวนผู้เล่นต้องอยู่ระหว่าง 2–64 คน");
  }
  if (new Set(inputPlayerIds).size !== inputPlayerIds.length) throw new Error("พบ Player ID ซ้ำ");
  const playerIds = shuffle([...inputPlayerIds]);
  if (playerIds.length !== inputPlayerIds.length || new Set(playerIds).size !== playerIds.length) {
    throw new Error("ผลการสุ่มผู้เล่นไม่ถูกต้อง");
  }
  const entrants = new Set(inputPlayerIds);
  if (playerIds.some((playerId) => !entrants.has(playerId))) throw new Error("ผลการสุ่มผู้เล่นไม่ถูกต้อง");
  const size = bracketSizeFor(playerIds.length);
  const roundCount = Math.log2(size);
  const firstRoundCount = size / 2;
  const byes = byeMatchIndexes(firstRoundCount, size - playerIds.length);
  const slots: Array<string | null> = [];
  let playerIndex = 0;
  for (let position = 0; position < firstRoundCount; position += 1) {
    if (byes.has(position)) {
      // Alternating the empty edge keeps visual weight symmetric.
      const player = playerIds[playerIndex++] ?? null;
      slots.push(position % 2 === 0 ? null : player, position % 2 === 0 ? player : null);
    } else {
      slots.push(playerIds[playerIndex++] ?? null, playerIds[playerIndex++] ?? null);
    }
  }

  const matches: BracketMatch[] = [];
  for (let round = 1; round <= roundCount; round += 1) {
    const count = size / (2 ** round);
    for (let position = 0; position < count; position += 1) {
      const nextRound = round + 1;
      matches.push({
        id: matchId(version, round, position), version, round, position,
        player1Id: round === 1 ? slots[position * 2] : null,
        player2Id: round === 1 ? slots[position * 2 + 1] : null,
        source1MatchId: round === 1 ? null : matchId(version, round - 1, position * 2),
        source2MatchId: round === 1 ? null : matchId(version, round - 1, position * 2 + 1),
        nextMatchId: round < roundCount ? matchId(version, nextRound, Math.floor(position / 2)) : null,
        nextSlot: round < roundCount ? (position % 2 === 0 ? 1 : 2) : null,
        score1: null, score2: null, winnerId: null,
        status: "waiting", revision: 0,
      });
    }
  }

  for (const match of matches.filter((item) => item.round === 1)) {
    if (match.player1Id && match.player2Id) match.status = "ready";
    else {
      match.status = "bye";
      match.winnerId = match.player1Id ?? match.player2Id;
      advanceWinner(matches, match);
    }
  }
  return { version, bracketRevision: 0, roundCount, matches };
}

function advanceWinner(matches: BracketMatch[], match: BracketMatch) {
  if (!match.nextMatchId || !match.nextSlot || !match.winnerId) return;
  const next = matches.find((item) => item.id === match.nextMatchId);
  if (!next) throw new Error("โครงสร้างสายการแข่งขันไม่สมบูรณ์");
  const previousPlayer = match.nextSlot === 1 ? next.player1Id : next.player2Id;
  if (match.nextSlot === 1) next.player1Id = match.winnerId;
  else next.player2Id = match.winnerId;
  if (previousPlayer !== match.winnerId) next.revision += 1;
  if (next.player1Id && next.player2Id) next.status = "ready";
}

export function recordBracketScore(
  bracket: KnockoutBracket,
  matchIdValue: string,
  score1: number,
  score2: number,
  expectedRevision: number,
): KnockoutBracket {
  if (![score1, score2].every((score) => Number.isInteger(score) && score >= 0 && score <= 99)) {
    throw new Error("คะแนนต้องเป็นจำนวนเต็ม 0–99");
  }
  if (score1 === score2) throw new Error("ผลการแข่งขันห้ามเสมอ");
  const matches = bracket.matches.map((match) => ({ ...match }));
  const match = matches.find((item) => item.id === matchIdValue);
  if (!match) throw new Error("ไม่พบ Match ที่เลือก");
  if (match.revision !== expectedRevision) throw new Error("stale match revision");
  if (!match.player1Id || !match.player2Id || !["ready", "completed"].includes(match.status)) {
    throw new Error("คู่นี้ยังไม่พร้อมบันทึกคะแนน");
  }
  const downstream = match.nextMatchId ? matches.find((item) => item.id === match.nextMatchId) : null;
  if (match.status === "completed" && downstream?.status === "completed") {
    throw new Error("แก้ผลไม่ได้ เพราะรอบถัดไปบันทึกผลแล้ว");
  }
  const winnerId = score1 > score2 ? match.player1Id : match.player2Id;
  match.score1 = score1;
  match.score2 = score2;
  match.winnerId = winnerId;
  match.status = "completed";
  match.revision += 1;
  advanceWinner(matches, match);
  return { ...bracket, bracketRevision: bracket.bracketRevision + 1, matches };
}

export function deriveMatchHistory(bracket: KnockoutBracket, playerId: string): MatchHistoryEntry[] {
  return bracket.matches
    .filter((match) => match.status === "completed" && match.winnerId === playerId)
    .sort((left, right) => left.round - right.round)
    .map((match) => {
      const playerIsOne = match.player1Id === playerId;
      return {
        matchId: match.id,
        round: match.round,
        opponentId: (playerIsOne ? match.player2Id : match.player1Id)!,
        scoreFor: (playerIsOne ? match.score1 : match.score2)!,
        scoreAgainst: (playerIsOne ? match.score2 : match.score1)!,
      };
    });
}
