"use client";

import { Medal, Swords, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo } from "react";
import { deriveMatchHistory } from "@/lib/bracket";
import { roundLabel } from "@/lib/bracket-ui";
import type { PublicPlayer, TournamentSnapshot } from "@/lib/types";
import styles from "./player-profile-sheet.module.css";

export function PlayerProfileSheet({ player, snapshot, onClose }: { player: PublicPlayer; snapshot: TournamentSnapshot; onClose: () => void }) {
  const players = useMemo(() => new Map(snapshot.players.map((item) => [item.id, item])), [snapshot.players]);
  const history = useMemo(() => deriveMatchHistory(snapshot, player.id), [snapshot, player.id]);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className={styles.handle} /><button className={styles.close} type="button" onClick={onClose} aria-label="ปิด"><X size={20} /></button><div className={styles.hero}><div className={styles.avatar}><Image src={player.avatarUrl} alt={`รูปของ ${player.nickname}`} fill sizes="96px" unoptimized /></div><div><span>{player.id}</span><h2 id="profile-title">{player.nickname}</h2><p>{player.department}</p></div></div><div className={styles.historyTitle}><Medal size={17} /><div><b>ประวัติการแข่งขัน</b><span>{history.length} ชัยชนะ</span></div></div>{history.length ? <ol className={styles.history}>{history.map((entry) => <li key={entry.matchId}><span>{roundLabel(entry.round, snapshot.roundCount)}</span><b>ชนะ {players.get(entry.opponentId)?.nickname ?? entry.opponentId}</b><strong>{entry.scoreFor}–{entry.scoreAgainst}</strong></li>)}</ol> : <div className={styles.empty}><Swords size={25} /><b>ยังไม่มีประวัติการแข่งขัน</b><span>ผลชนะพร้อมคะแนนจะปรากฏที่นี่หลังจบแมตช์แรก</span></div>}<button className={styles.done} type="button" onClick={onClose}>ปิดโปรไฟล์</button></section></div>;
}
