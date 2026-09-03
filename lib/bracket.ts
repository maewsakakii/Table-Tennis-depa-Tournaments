import type { BracketMatch, Division, KnockoutBracket, MatchHistoryEntry } from "./types.ts";
import { defaultMatchDate } from "./match-date.ts";

export type ShufflePlayers = (playerIds: string[]) => string[];

function bracketSizeFor(count: number) {
  return 2 ** Math.ceil(Math.log2(count));
}

function matchId(division: Division, version: number, round: number, position: number) {
  return `v${version}-${division}-r${round}-m${position}`;
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
  division: Division = "male",
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
        id: matchId(division, version, round, position), version, round, position, division,
        player1Id: round === 1 ? slots[position * 2] : null,
        player2Id: round === 1 ? slots[position * 2 + 1] : null,
        source1MatchId: round === 1 ? null : matchId(division, version, round - 1, position * 2),
        source2MatchId: round === 1 ? null : matchId(division, version, round - 1, position * 2 + 1),
        nextMatchId: round < roundCount ? matchId(division, version, nextRound, Math.floor(position / 2)) : null,
        nextSlot: round < roundCount ? (position % 2 === 0 ? 1 : 2) : null,
        player1PartnerId: null, player2PartnerId: null,
        score1: null, score2: null, winnerId: null,
        status: "waiting", revision: 0,
        scheduledDate: defaultMatchDate(matches.length),
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

export type MixedTeam = { captain: string; partner: string };

/** Players in the order the draw placed them in that division's first round. */
export function divisionSeedOrder(bracket: KnockoutBracket, division: Division): string[] {
  return bracket.matches
    .filter((match) => match.division === division && match.round === 1)
    .sort((left, right) => left.position - right.position)
    .flatMap((match) => [match.player1Id, match.player2Id])
    .filter((id): id is string => Boolean(id));
}

/** Pairs by seed position: the first man in the men's draw partners the first woman in the women's. */
export function buildMixedTeams(maleOrder: string[], femaleOrder: string[]): MixedTeam[] {
  const count = Math.min(maleOrder.length, femaleOrder.length);
  return Array.from({ length: count }, (_, index) => ({ captain: maleOrder[index], partner: femaleOrder[index] }));
}

/** Teams keep their seed order, so team 1 meets team 2, team 3 meets team 4, and so on. */
export function generateMixedBracket(teams: MixedTeam[], version: number): KnockoutBracket {
  const keys = teams.map((_, index) => `T${index}`);
  const seeded = generateKnockoutBracket(keys, version, (values) => values, "mixed");
  const byKey = new Map(keys.map((key, index) => [key, teams[index]]));
  const captainOf = (key: string | null) => (key ? byKey.get(key)?.captain ?? null : null);
  const partnerOf = (key: string | null) => (key ? byKey.get(key)?.partner ?? null : null);
  return {
    ...seeded,
    matches: seeded.matches.map((match) => ({
      ...match,
      player1Id: captainOf(match.player1Id),
      player2Id: captainOf(match.player2Id),
      player1PartnerId: partnerOf(match.player1Id),
      player2PartnerId: partnerOf(match.player2Id),
      winnerId: captainOf(match.winnerId),
    })),
  };
}

/** Builds one independent bracket per division and merges them into a single snapshot.
 *  The mixed bracket is derived from where the draw placed each player in their own division. */
export function generateDivisionalBrackets(
  idsByDivision: Record<"male" | "female", string[]>,
  version: number,
  shuffle: ShufflePlayers,
): KnockoutBracket {
  const gendered: Array<"male" | "female"> = ["male", "female"];
  const built = gendered.map((division) => generateKnockoutBracket(idsByDivision[division], version, shuffle, division));
  const genderedMatches = built.flatMap((bracket) => bracket.matches);
  const seedSource: KnockoutBracket = { version, bracketRevision: 0, roundCount: 0, matches: genderedMatches };
  const teams = buildMixedTeams(divisionSeedOrder(seedSource, "male"), divisionSeedOrder(seedSource, "female"));
  const mixed = teams.length >= 2 ? generateMixedBracket(teams, version) : null;
  const matches = mixed ? [...genderedMatches, ...mixed.matches] : genderedMatches;
  return {
    version,
    bracketRevision: 0,
    roundCount: Math.max(0, ...built.map((bracket) => bracket.roundCount), mixed?.roundCount ?? 0),
    matches,
  };
}

function advanceWinner(matches: BracketMatch[], match: BracketMatch) {
  if (!match.nextMatchId || !match.nextSlot || !match.winnerId) return;
  const next = matches.find((item) => item.id === match.nextMatchId);
  if (!next) throw new Error("โครงสร้างสายการแข่งขันไม่สมบูรณ์");
  // In mixed doubles the partner travels with the captain, so the whole side advances.
  const winningPartner = match.winnerId === match.player1Id ? match.player1PartnerId : match.player2PartnerId;
  const previousPlayer = match.nextSlot === 1 ? next.player1Id : next.player2Id;
  if (match.nextSlot === 1) {
    next.player1Id = match.winnerId;
    next.player1PartnerId = winningPartner;
  } else {
    next.player2Id = match.winnerId;
    next.player2PartnerId = winningPartner;
  }
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

/** True when the player competed on the side that `winnerId` represents (captain or partner). */
function wonAsSide(match: BracketMatch, playerId: string) {
  if (match.winnerId === playerId) return true;
  if (match.winnerId === match.player1Id) return match.player1PartnerId === playerId;
  if (match.winnerId === match.player2Id) return match.player2PartnerId === playerId;
  return false;
}

export function deriveMatchHistory(bracket: KnockoutBracket, playerId: string): MatchHistoryEntry[] {
  return bracket.matches
    .filter((match) => match.status === "completed" && wonAsSide(match, playerId))
    .sort((left, right) => left.round - right.round)
    .map((match) => {
      const playerIsOne = match.player1Id === playerId || match.player1PartnerId === playerId;
      return {
        matchId: match.id,
        round: match.round,
        opponentId: (playerIsOne ? match.player2Id : match.player1Id)!,
        scoreFor: (playerIsOne ? match.score1 : match.score2)!,
        scoreAgainst: (playerIsOne ? match.score2 : match.score1)!,
      };
    });
}

/** Player profile statistics are singles-only; mixed doubles remain visible in its own bracket. */
export function deriveSinglesMatchHistory(bracket: KnockoutBracket, playerId: string): MatchHistoryEntry[] {
  return deriveMatchHistory(
    { ...bracket, matches: bracket.matches.filter((match) => match.division !== "mixed") },
    playerId,
  );
}
