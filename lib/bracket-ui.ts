import type { BracketMatch, TournamentSnapshot } from "./types.ts";

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

/** Always materializes every round, including rounds whose players are not known yet. */
export function buildBracketRounds(snapshot: TournamentSnapshot): BracketRoundView[] {
  return Array.from({ length: snapshot.roundCount }, (_, index) => {
    const round = index + 1;
    return {
      round,
      label: roundLabel(round, snapshot.roundCount),
      matches: snapshot.matches
        .filter((match) => match.round === round)
        .sort((left, right) => left.position - right.position),
    };
  });
}

export function futureSourceLabel(snapshot: TournamentSnapshot, sourceMatchId: string | null) {
  if (!sourceMatchId) return "รอผลการแข่งขัน";
  const source = snapshot.matches.find((match) => match.id === sourceMatchId);
  if (!source) return "รอผลการแข่งขัน";
  return `ผู้ชนะคู่ ${source.position + 1} · ${roundLabel(source.round, snapshot.roundCount)}`;
}
