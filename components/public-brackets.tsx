"use client";

import { Radio, RefreshCw, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlayerProfileSheet } from "@/components/player-profile-sheet";
import { TournamentBracket } from "@/components/tournament-bracket";
import { getPublicTournamentSnapshot, subscribeToTournamentState } from "@/lib/tournament-store";
import type { Division, PublicPlayer, TournamentSnapshot } from "@/lib/types";
import styles from "./public-brackets.module.css";

const emptySnapshot: TournamentSnapshot = { version: 0, bracketRevision: 0, roundCount: 0, matches: [], players: [] };
const divisionTabs: Array<{ key: Division; label: string }> = [
  { key: "male", label: "สายชาย" },
  { key: "female", label: "สายหญิง" },
  { key: "mixed", label: "คู่ผสม" },
];

export function PublicBrackets() {
  const [snapshot, setSnapshot] = useState<TournamentSnapshot>(emptySnapshot);
  const [division, setDivision] = useState<Division>("male");
  const [profile, setProfile] = useState<PublicPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try { setSnapshot(await getPublicTournamentSnapshot()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดสายการแข่งขันไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const interval = window.setInterval(() => { void refresh(); }, 15_000);
    const unsubscribe = subscribeToTournamentState(() => { void refresh(); });
    return () => { window.clearTimeout(timer); window.clearInterval(interval); unsubscribe(); };
  }, [refresh]);

  return <main className={styles.page}>
    <header className={styles.topbar}><Link href="/" className={styles.brand}><span><Trophy size={20} /></span><div><b>depa TABLE TENNIS</b><small>PUBLIC BRACKETS · 2026</small></div></Link><div className={styles.live}><i /> LIVE</div></header>
    <div className={styles.body}>
      <section className={styles.hero}><div><span><Radio size={13} /> TOURNAMENT VIEWER</span><h1>สายการแข่งขัน</h1><p>ติดตามคู่แข่งขัน วันแข่งขัน และผลคะแนนล่าสุดได้จากหน้านี้</p></div><button type="button" onClick={() => void refresh()} disabled={loading} aria-label="รีเฟรชสายการแข่งขัน"><RefreshCw size={18} className={loading ? styles.spinning : ""} /></button></section>
      {error && <div className={styles.error}>{error}<button type="button" onClick={() => void refresh()}>ลองอีกครั้ง</button></div>}
      {!error && loading && !snapshot.matches.length ? <div className={styles.loading}><i /><span>กำลังโหลดสายการแข่งขัน</span></div> : <>
        {snapshot.matches.length > 0 && <div className={styles.summary}><b>DRAW #{snapshot.version}</b><span>อัปเดตผลครั้งที่ {snapshot.bracketRevision}</span></div>}
        {snapshot.matches.length > 0 && <div className={styles.tabs} role="tablist" aria-label="เลือกสายการแข่งขัน">{divisionTabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={division === tab.key} className={division === tab.key ? styles.active : ""} onClick={() => setDivision(tab.key)}>{tab.label}<small>{snapshot.matches.filter((match) => match.division === tab.key && match.round === 1).length} คู่แรก</small></button>)}</div>}
        <TournamentBracket snapshot={snapshot} division={division} onSelectPlayer={setProfile} />
      </>}
    </div>
    {profile && <PlayerProfileSheet player={profile} snapshot={snapshot} onClose={() => setProfile(null)} />}
  </main>;
}
