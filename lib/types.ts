export type Player = {
  /** Public display ID (for example DT-01). It is not an authentication secret. */
  id: string;
  nickname: string;
  department: string;
  email?: string | null;
  avatarUrl: string;
  registeredAt: string;
  status: "waiting";
  /** Admin-only test roster marker. Never treat this as an identity credential. */
  isDemo?: boolean;
  demoSlot?: number | null;
};

export type PublicPlayer = Pick<Player, "id" | "nickname" | "department" | "avatarUrl">;

export type MatchPair = {
  id: string;
  player1: PublicPlayer;
  player2: PublicPlayer | null;
};

export type TournamentState = {
  version: number;
  status: "registration" | "locked";
  registrationOpen: boolean;
  revealOpen: boolean;
  startedAt: string | null;
};

export type HiddenMatchPair = {
  id: string;
  player1Id: string;
  player2Id: string | null;
};

export type AdminDraw = {
  version: number;
  pairs: HiddenMatchPair[];
};

export type PlayerIdentity = {
  playerId: string;
  /** High-entropy recovery secret. Never use the public player ID as authentication. */
  recoveryCode: string;
};

export type PlayerRegistration = {
  player: Player;
  recoveryCode: string;
};

export type PlayerReveal = {
  matchId: string;
  playerId: string;
  opponent: PublicPlayer | null;
  bye: boolean;
};

export type BracketMatchStatus = "waiting" | "ready" | "bye" | "completed";

export type BracketMatch = {
  id: string;
  version: number;
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  source1MatchId: string | null;
  source2MatchId: string | null;
  nextMatchId: string | null;
  nextSlot: 1 | 2 | null;
  score1: number | null;
  score2: number | null;
  winnerId: string | null;
  status: BracketMatchStatus;
  revision: number;
};

export type KnockoutBracket = {
  version: number;
  bracketRevision: number;
  roundCount: number;
  matches: BracketMatch[];
};

export type MatchHistoryEntry = {
  matchId: string;
  round: number;
  opponentId: string;
  scoreFor: number;
  scoreAgainst: number;
};

export type TournamentSnapshot = KnockoutBracket & {
  players: PublicPlayer[];
};

export type PlayerTournamentSnapshot = TournamentSnapshot & {
  playerId: string;
  currentMatchId: string | null;
  currentOpponentId: string | null;
  bye: boolean;
};
