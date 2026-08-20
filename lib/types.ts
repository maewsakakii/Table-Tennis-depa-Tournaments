export type Player = {
  /** Public display ID (for example DT-01). It is not an authentication secret. */
  id: string;
  nickname: string;
  department: string;
  email?: string | null;
  avatarUrl: string;
  registeredAt: string;
  status: "waiting";
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
