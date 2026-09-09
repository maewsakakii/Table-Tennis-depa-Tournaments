"use client";

import { CalendarDays, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchesScheduledOn } from "@/lib/bracket-ui";
import { formatMatchDate } from "@/lib/match-date";
import type { PublicPlayer, TournamentSnapshot } from "@/lib/types";
import styles from "./today-schedule-sheet.module.css";

export function TodayScheduleSheet({ snapshot, dateKey, onClose, onSelectPlayer }: { snapshot: TournamentSnapshot; dateKey: string; onClose: () => void; onSelectPlayer: (player: PublicPlayer) => void }) {
  const players = useMemo(() => new Map(snapshot.players.map((player) => [player.id, player])), [snapshot.players]);
  const schedule = useMemo(() => matchesScheduledOn(snapshot, dateKey), [snapshot, dateKey]);
  // Snapping a match to the top only lands cleanly if the scroll padding matches the real header height,
  // which differs between phone and desktop and grows when the date line wraps.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeaderHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);

  return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={styles.sheet} style={headerHeight ? { scrollPaddingTop: headerHeight + 10 } : undefined} role="dialog" aria-modal="true" aria-labelledby="today-schedule-title">
      {/* Pinned so the title and date stay in frame while scrolling — the list is screenshotted and shared. */}
      <div className={styles.header} ref={headerRef}>
        <div className={styles.handle} />
        <button className={styles.close} type="button" onClick={onClose} aria-label="ปิด"><X size={20} /></button>
        <div className={styles.hero}><span><CalendarDays size={13} /> MATCH DAY</span><h2 id="today-schedule-title">ตารางแข่งวันนี้</h2><p>{formatMatchDate(dateKey)} · {schedule.length} คู่</p></div>
      </div>
      {schedule.length
        ? <ol className={styles.list}>{schedule.map(({ match, divisionLabel, roundLabel }) => <li key={match.id}>
            <div className={styles.tags}><b>{divisionLabel}</b><span>{roundLabel} · คู่ {match.position + 1}</span></div>
            <div className={styles.pair}>
              <Side side={sidePlayers(match.player1Id, match.player1PartnerId, players)} score={match.score1} winner={Boolean(match.winnerId) && match.winnerId === match.player1Id} onSelectPlayer={onSelectPlayer} />
              <i>VS</i>
              <Side side={sidePlayers(match.player2Id, match.player2PartnerId, players)} score={match.score2} winner={Boolean(match.winnerId) && match.winnerId === match.player2Id} onSelectPlayer={onSelectPlayer} />
            </div>
            <small className={match.status === "completed" ? styles.done : styles.pending}>{match.status === "completed" ? "จบแล้ว" : match.status === "ready" ? "พร้อมแข่ง" : "รอผลรอบก่อนหน้า"}</small>
          </li>)}</ol>
        : <div className={styles.empty}><CalendarDays size={25} /><b>วันนี้ไม่มีคู่แข่งขัน</b><span>เมื่อแอดมินกำหนดวันแข่งตรงกับวันนี้ คู่แข่งขันจะขึ้นที่นี่</span></div>}
      <button className={styles.doneButton} type="button" onClick={onClose}>ปิดตาราง</button>
    </section>
  </div>;
}

/** One side of a match: a single player, or both partners of a mixed doubles pair. */
function sidePlayers(playerId: string | null, partnerId: string | null, players: Map<string, PublicPlayer>) {
  const player = playerId ? players.get(playerId) : null;
  if (!player) return [];
  const partner = partnerId ? players.get(partnerId) : null;
  return partner ? [player, partner] : [player];
}

function Side({ side, score, winner, onSelectPlayer }: { side: PublicPlayer[]; score: number | null; winner: boolean; onSelectPlayer: (player: PublicPlayer) => void }) {
  if (!side.length) return <div className={`${styles.side} ${styles.unknownSide}`}><span>?</span><b>รอผู้ชนะรอบก่อนหน้า</b></div>;
  return <div className={`${styles.side} ${winner ? styles.winner : ""}`}>
    <div className={styles.faces}>{side.map((player) => <button key={player.id} type="button" className={styles.face} onClick={() => onSelectPlayer(player)} aria-label={`ดูโปรไฟล์ ${player.nickname}`}><Image src={player.avatarUrl} alt="" fill sizes="40px" unoptimized /></button>)}</div>
    <div className={styles.names}>{side.map((player) => <b key={player.id}>{player.nickname}</b>)}<span>{side.map((player) => player.id).join(" · ")}</span></div>
    {score !== null && <strong>{score}</strong>}
  </div>;
}

