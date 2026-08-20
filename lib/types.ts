export type Player = {
  id: string;
  nickname: string;
  department: string;
  email: string;
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
  status: "registration" | "drawing" | "ready";
  roster: PublicPlayer[];
  pairs: MatchPair[];
  startedAt: string | null;
};
