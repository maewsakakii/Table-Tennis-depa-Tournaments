"use client";

import { CircleAlert, Save, X } from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { BracketMatch, PublicPlayer } from "@/lib/types";
import styles from "./score-entry-sheet.module.css";

export function ScoreEntrySheet({ match, players, onClose, onSave }: { match: BracketMatch; players: PublicPlayer[]; onClose: () => void; onSave: (score1: number, score2: number) => Promise<void> }) {
  const playerMap = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const first = match.player1Id ? playerMap.get(match.player1Id) : null;
  const second = match.player2Id ? playerMap.get(match.player2Id) : null;
  const [score1, setScore1] = useState(match.score1?.toString() ?? "");
  const [score2, setScore2] = useState(match.score2?.toString() ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const firstScore = Number(score1);
    const secondScore = Number(score2);
    if (!score1 || !score2 || ![firstScore, secondScore].every((score) => Number.isInteger(score) && score >= 0 && score <= 99)) { setError("คะแนนต้องเป็นจำนวนเต็ม 0–99"); return; }
    if (firstScore === secondScore) { setError("ผลการแข่งขันห้ามเสมอ กรุณาตรวจคะแนนอีกครั้ง"); return; }
    setSaving(true); setError("");
    try { await onSave(firstScore, secondScore); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกคะแนนไม่สำเร็จ"); }
    finally { setSaving(false); }
  }

  return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="score-sheet-title"><div className={styles.handle} /><button className={styles.close} type="button" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={20} /></button><span className={styles.kicker}>MATCH {match.position + 1} · ROUND {match.round}</span><h2 id="score-sheet-title">บันทึกผลการแข่งขัน</h2><p>ผู้ชนะจะเข้าสู่รอบถัดไปอัตโนมัติ</p><form onSubmit={submit}><div className={styles.scoreGrid}><ScorePlayer player={first} score={score1} onChange={setScore1} label="คะแนนผู้เล่นคนที่ 1" autoFocus /><b>–</b><ScorePlayer player={second} score={score2} onChange={setScore2} label="คะแนนผู้เล่นคนที่ 2" /></div>{error && <div className={styles.error} role="alert"><CircleAlert size={16} />{error}</div>}<button className={styles.save} type="submit" disabled={saving || !first || !second}><Save size={18} />{saving ? "กำลังบันทึก..." : match.status === "completed" ? "ยืนยันการแก้ไขผล" : "บันทึกและส่งผู้ชนะเข้ารอบ"}</button><button className={styles.cancel} type="button" onClick={onClose} disabled={saving}>ยกเลิก</button></form></section></div>;
}

function ScorePlayer({ player, score, onChange, label, autoFocus = false }: { player: PublicPlayer | undefined | null; score: string; onChange: (value: string) => void; label: string; autoFocus?: boolean }) {
  return <label className={styles.player}><div className={styles.avatar}>{player && <Image src={player.avatarUrl} alt="" fill sizes="54px" unoptimized />}</div><span>{player?.id ?? "—"}</span><strong>{player?.nickname ?? "รอผู้เล่น"}</strong><input type="number" inputMode="numeric" min={0} max={99} step={1} value={score} onChange={(event) => onChange(event.target.value)} aria-label={`${label} ${player?.nickname ?? ""}`} disabled={!player} autoFocus={autoFocus} required /></label>;
}
