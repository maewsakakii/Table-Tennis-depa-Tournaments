"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, FastForward, Radio, Trophy } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { PlayerReveal, PublicPlayer } from "@/lib/types";
import styles from "./matchmaking-roulette.module.css";

const SEARCH_LABELS = ["กำลังค้นหาคู่แข่ง", "ล็อกเป้าหมาย", "ตรวจสอบสายแข่งขัน"];

/** Plays a private reveal. It never receives the roster or any other hidden matches. */
export function MatchmakingRoulette({
  player,
  reveal,
  onFinish,
}: {
  player: PublicPlayer;
  reveal: PlayerReveal;
  onFinish: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [spinning, setSpinning] = useState(true);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const finishTimer = window.setTimeout(() => setSpinning(false), reduceMotion ? 120 : 2200);
    const cycleTimer = window.setInterval(() => setCycle((value) => value + 1), reduceMotion ? 120 : 260);
    return () => {
      window.clearTimeout(finishTimer);
      window.clearInterval(cycleTimer);
    };
  }, [reduceMotion, reveal.matchId]);

  return (
    <motion.section className={styles.overlay} role="dialog" aria-modal="true" aria-label="ผลการจับคู่ของคุณ" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.grid} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.live}><Radio size={13} /> PRIVATE DRAW</div>
        <b>depa TABLE TENNIS 2026</b>
        <span>{player.id}</span>
      </header>

      <div className={styles.stage} aria-live="polite">
        <div className={styles.kicker}>{spinning ? "SCANNING LOCKED DRAW" : "YOUR MATCH IS READY"}</div>
        <h1>{spinning ? SEARCH_LABELS[cycle % SEARCH_LABELS.length] : reveal.bye ? "คุณชนะบายรอบแรก" : "พบคู่แข่งของคุณแล้ว"}</h1>
        <div className={styles.versus}>
          <PlayerSlot player={player} side="left" />
          <motion.div className={styles.vs} animate={spinning ? { scale: [1, 1.14, 1], rotate: [-4, 4, -4] } : { scale: [1.8, 1], rotate: 0 }} transition={spinning ? { repeat: Infinity, duration: .5 } : { type: "spring" }}>
            {reveal.bye ? <Trophy size={32} /> : "VS"}
          </motion.div>
          {spinning ? <SearchingSlot cycle={cycle} /> : reveal.opponent ? <PlayerSlot player={reveal.opponent} side="right" /> : <div className={`${styles.playerSlot} ${styles.byeSlot}`}><b>BYE</b><span>ผ่านเข้ารอบอัตโนมัติ</span></div>}
        </div>
        <AnimatePresence>
          {!spinning && <motion.div className={styles.locked} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><Check size={17} /> คู่แข่งขันถูกล็อกไว้แล้ว · กดซ้ำก็ได้คู่เดิม</motion.div>}
        </AnimatePresence>
      </div>

      <div className={styles.progress}><i style={{ width: spinning ? "72%" : "100%" }} /></div>
      <button className={styles.skip} onClick={spinning ? () => setSpinning(false) : onFinish}>
        {spinning ? <><FastForward size={17} /> ข้ามแอนิเมชัน</> : <><Check size={18} /> กลับหน้า Lobby</>}
      </button>
    </motion.section>
  );
}

function SearchingSlot({ cycle }: { cycle: number }) {
  return <motion.div key={cycle} className={`${styles.playerSlot} ${styles.searchingSlot}`} initial={{ opacity: .25, y: -12 }} animate={{ opacity: 1, y: 0 }}><div className={styles.mysteryAvatar}>?</div><span>LOCKED PLAYER</span><h2>{SEARCH_LABELS[cycle % SEARCH_LABELS.length]}</h2></motion.div>;
}

function PlayerSlot({ player, side }: { player: PublicPlayer; side: "left" | "right" }) {
  return (
    <motion.article key={`${side}-${player.id}`} className={`${styles.playerSlot} ${styles[side]}`} initial={{ opacity: 0, x: side === "left" ? -45 : 45 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .38, type: "spring" }}>
      <div className={styles.avatar}><Image src={player.avatarUrl} alt={`รูปของ ${player.nickname}`} fill unoptimized /></div>
      <span>{player.id} · {player.department}</span><h2>{player.nickname}</h2>
    </motion.article>
  );
}
