"use client";

import { ChevronLeft, ChevronRight, Medal, Trophy, UserRound } from "lucide-react";
import Image from "next/image";
import { UIEvent, useMemo, useRef, useState } from "react";
import { buildBracketRounds, futureSourceLabel } from "@/lib/bracket-ui";
import type { BracketMatch, PublicPlayer, TournamentSnapshot } from "@/lib/types";
import styles from "./tournament-bracket.module.css";

export function TournamentBracket({
  snapshot,
  currentPlayerId,
  admin = false,
  onSelectMatch,
  onSelectPlayer,
}: {
  snapshot: TournamentSnapshot;
  currentPlayerId?: string;
  admin?: boolean;
  onSelectMatch?: (match: BracketMatch) => void;
  onSelectPlayer: (player: PublicPlayer) => void;
}) {
  const rounds = useMemo(() => buildBracketRounds(snapshot), [snapshot]);
  const players = useMemo(() => new Map(snapshot.players.map((player) => [player.id, player])), [snapshot.players]);
  const playerPath = useMemo(() => {
    const path = new Set<string>();
    if (!currentPlayerId) return path;
    let match = snapshot.matches.find((candidate) => candidate.player1Id === currentPlayerId || candidate.player2Id === currentPlayerId);
    while (match) {
      path.add(match.id);
      match = match.nextMatchId ? snapshot.matches.find((candidate) => candidate.id === match?.nextMatchId) : undefined;
    }
    return path;
  }, [currentPlayerId, snapshot.matches]);
  const [activeRound, setActiveRound] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rounds are measured, not assumed one-viewport-wide: desktop shows several columns at once.
  function goToRound(index: number) {
    const safeIndex = Math.max(0, Math.min(index, rounds.length - 1));
    setActiveRound(safeIndex);
    const container = scrollRef.current;
    const target = container?.children[safeIndex] as HTMLElement | undefined;
    if (container && target) container.scrollTo({ left: target.offsetLeft - container.offsetLeft, behavior: "smooth" });
  }

  function trackRound(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const columns = Array.from(container.children) as HTMLElement[];
    if (!columns.length) return;
    const target = container.offsetLeft + container.scrollLeft;
    const nearest = columns.reduce(
      (best, column, index) => Math.abs(column.offsetLeft - target) < Math.abs(columns[best].offsetLeft - target) ? index : best,
      0,
    );
    setActiveRound(nearest);
  }

  if (!rounds.length || !snapshot.matches.length) {
    return <div className={styles.empty}><Trophy size={30} /><b>ยังไม่มีสายการแข่งขัน</b><span>สายเต็มจะปรากฏหลังแอดมินกดสุ่มและล็อกคู่</span></div>;
  }

  return <section className={styles.bracket} aria-label="สายการแข่งขันแบบแพ้คัดออก">
    <div className={styles.roundTabs} role="tablist" aria-label="เลือกรอบการแข่งขัน">
      {rounds.map((round, index) => <button key={round.round} type="button" role="tab" aria-selected={activeRound === index} className={activeRound === index ? styles.activeTab : ""} onClick={() => goToRound(index)}>{round.label}<small>{round.matches.length} คู่</small></button>)}
    </div>
    <div className={styles.roundViewport} ref={scrollRef} onScroll={trackRound}>
      {rounds.map((round) => <section className={styles.round} key={round.round} aria-label={round.label}><header><span>ROUND {String(round.round).padStart(2, "0")}</span><h3>{round.label}</h3></header><div className={styles.matchList}>{round.matches.map((match) => <MatchCard key={match.id} match={match} snapshot={snapshot} players={players} currentPlayerId={currentPlayerId} onPath={playerPath.has(match.id)} admin={admin} onSelectMatch={onSelectMatch} onSelectPlayer={onSelectPlayer} />)}</div></section>)}
    </div>
    <div className={styles.roundNav}><button type="button" onClick={() => goToRound(activeRound - 1)} disabled={activeRound === 0}><ChevronLeft size={18} /> รอบก่อนหน้า</button><span>{activeRound + 1} / {rounds.length}</span><button type="button" onClick={() => goToRound(activeRound + 1)} disabled={activeRound === rounds.length - 1}>รอบถัดไป <ChevronRight size={18} /></button></div>
  </section>;
}

function MatchCard({ match, snapshot, players, currentPlayerId, onPath, admin, onSelectMatch, onSelectPlayer }: { match: BracketMatch; snapshot: TournamentSnapshot; players: Map<string, PublicPlayer>; currentPlayerId?: string; onPath: boolean; admin: boolean; onSelectMatch?: (match: BracketMatch) => void; onSelectPlayer: (player: PublicPlayer) => void }) {
  const actionable = admin && Boolean(onSelectMatch) && match.player1Id && match.player2Id && (match.status === "ready" || match.status === "completed");
  return <article className={`${styles.matchCard} ${onPath ? styles.playerPath : ""} ${actionable ? styles.actionable : ""}`} onClick={actionable ? () => onSelectMatch?.(match) : undefined}>
    <div className={styles.matchTop}><span>คู่ {match.position + 1}</span><Status match={match} /></div>
    <PlayerSlot slot={1} playerId={match.player1Id} sourceId={match.source1MatchId} match={match} snapshot={snapshot} players={players} currentPlayerId={currentPlayerId} onSelectPlayer={onSelectPlayer} />
    <div className={styles.divider}><i /><b>VS</b><i /></div>
    <PlayerSlot slot={2} playerId={match.player2Id} sourceId={match.source2MatchId} match={match} snapshot={snapshot} players={players} currentPlayerId={currentPlayerId} onSelectPlayer={onSelectPlayer} />
    {actionable && <button className={styles.scoreAction} type="button" onClick={(event) => { event.stopPropagation(); onSelectMatch?.(match); }}>{match.status === "completed" ? "แก้ไขผลการแข่งขัน" : "กรอกคะแนนการแข่งขัน"}</button>}
  </article>;
}

function PlayerSlot({ slot, playerId, sourceId, match, snapshot, players, currentPlayerId, onSelectPlayer }: { slot: 1 | 2; playerId: string | null; sourceId: string | null; match: BracketMatch; snapshot: TournamentSnapshot; players: Map<string, PublicPlayer>; currentPlayerId?: string; onSelectPlayer: (player: PublicPlayer) => void }) {
  const player = playerId ? players.get(playerId) : null;
  const loser = Boolean(playerId && match.status === "completed" && match.winnerId && match.winnerId !== playerId);
  const isCurrent = playerId === currentPlayerId;
  const score = slot === 1 ? match.score1 : match.score2;
  if (!player) {
    if (match.status === "bye") return <div className={styles.futureSlot}><span>—</span><div><b>บาย</b><small>ไม่มีคู่แข่งในรอบนี้</small></div></div>;
    return <div className={styles.futureSlot}><span>?</span><div><b>{futureSourceLabel(snapshot, sourceId)}</b><small>ยังไม่ทราบผู้เล่น</small></div></div>;
  }
  return <button type="button" className={`${styles.playerSlot} ${loser ? styles.loser : ""} ${isCurrent ? styles.currentPlayer : ""}`} onClick={(event) => { event.stopPropagation(); onSelectPlayer(player); }} aria-label={`ดูโปรไฟล์ ${player.nickname}`}><div className={styles.avatar}><Image src={player.avatarUrl} alt="" fill sizes="42px" unoptimized /></div><div><b>{player.nickname}</b><span>{player.id} · {player.department}</span></div>{score !== null ? <strong>{score}</strong> : <UserRound size={16} />}</button>;
}

function Status({ match }: { match: BracketMatch }) {
  if (match.status === "completed") return <b className={styles.completed}><Medal size={12} /> จบแล้ว</b>;
  if (match.status === "bye") return <b className={styles.bye}><Trophy size={12} /> ชนะบาย</b>;
  if (match.status === "ready") return <b className={styles.ready}>พร้อมแข่ง</b>;
  return <b className={styles.waiting}>รอผลก่อนหน้า</b>;
}
