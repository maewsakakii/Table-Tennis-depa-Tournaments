import type { BracketMatch, Division, TournamentSnapshot } from "./types.ts";

export type BracketRoundView = {
  round: number;
  label: string;
  matches: BracketMatch[];
};

export function roundLabel(round: number, roundCount: number) {
  if (round === roundCount) return "รอบชิงชนะเลิศ";
  if (round === roundCount - 1) return "รอบรองชนะเลิศ";
  if (round === 1) return "รอบแรก";
  return `รอบที่ ${round}`;
}

/** Always materializes every round, including rounds whose players are not known yet.
 *  Round count is derived from the matches on show, so filtering to one division works. */
export function buildBracketRounds(snapshot: TournamentSnapshot, division?: Division): BracketRoundView[] {
  const matches = division ? snapshot.matches.filter((match) => match.division === division) : snapshot.matches;
  const roundCount = matches.reduce((max, match) => Math.max(max, match.round), 0);
  return Array.from({ length: roundCount }, (_, index) => {
    const round = index + 1;
    return {
      round,
      label: roundLabel(round, roundCount),
      matches: matches
        .filter((match) => match.round === round)
        .sort((left, right) => left.position - right.position),
    };
  });
}

export function futureSourceLabel(snapshot: TournamentSnapshot, sourceMatchId: string | null) {
  if (!sourceMatchId) return "รอผลการแข่งขัน";
  const source = snapshot.matches.find((match) => match.id === sourceMatchId);
  if (!source) return "รอผลการแข่งขัน";
  const divisionRounds = snapshot.matches.reduce((max, match) => match.division === source.division ? Math.max(max, match.round) : max, 0);
  return `ผู้ชนะคู่ ${source.position + 1} · ${roundLabel(source.round, divisionRounds)}`;
}
