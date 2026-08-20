"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, FastForward, Radio, Swords, Trophy } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { PublicPlayer, TournamentState } from "@/lib/types";
import styles from "./matchmaking-roulette.module.css";

export function MatchmakingRoulette({
  state,
  onFinish,
}: {
  state: TournamentState;
  onFinish: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [pairIndex, setPairIndex] = useState(0);
  const [spinning, setSpinning] = useState(true);
  const [complete, setComplete] = useState(false);
  const [cycle, setCycle] = useState(0);
  const pairs = state.pairs;
  const roster = state.roster;

  useEffect(() => {
    const timers: number[] = [];
    const spinTime = reduceMotion ? 50 : 1500;
    const pairTime = reduceMotion ? 150 : 2500;

    pairs.forEach((_, index) => {
      timers.push(window.setTimeout(() => {
        setPairIndex(index);
        setSpinning(true);
      }, index * pairTime));
      timers.push(window.setTimeout(() => setSpinning(false), index * pairTime + spinTime));
    });
    timers.push(window.setTimeout(() => setComplete(true), Math.max(1, pairs.length) * pairTime));
    return () => timers.forEach(window.clearTimeout);
  }, [pairs, reduceMotion, state.version]);

  useEffect(() => {
    if (!spinning || roster.length < 2) return;
    const timer = window.setInterval(() => setCycle((value) => value + 1), reduceMotion ? 200 : 90);
    return () => window.clearInterval(timer);
  }, [reduceMotion, roster.length, spinning]);

  const pair = pairs[Math.min(pairIndex, Math.max(0, pairs.length - 1))];
  const displayPlayers = useMemo(() => {
    if (!pair) return [roster[0], roster[1]] as const;
    if (!spinning || roster.length < 2) return [pair.player1, pair.player2] as const;
    return [roster[cycle % roster.length], roster[(cycle * 3 + 1) % roster.length]] as const;
  }, [cycle, pair, roster, spinning]);

  if (!pair || !displayPlayers[0]) return null;

  return (
    <motion.section className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.grid} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.live}><Radio size={13} /> LIVE DRAW</div>
        <b>depa TABLE TENNIS 2026</b>
        <span>{String(pairIndex + 1).padStart(2, "0")} / {String(pairs.length).padStart(2, "0")}</span>
      </header>

      <div className={styles.stage}>
        <div className={styles.kicker}>{spinning ? "SEARCHING FOR RIVALS" : "MATCH LOCKED"}</div>
        <h1>{spinning ? "กำลังสุ่มคู่เดือด" : pair.player2 ? "คู่ต่อสู้ถูกล็อกแล้ว" : "ชนะบายรอบแรก"}</h1>

        <div className={styles.versus}>
          <PlayerSlot player={displayPlayers[0]} side="left" spinning={spinning} />
          <motion.div
            className={styles.vs}
            animate={spinning ? { scale: [1, 1.14, 1], rotate: [-4, 4, -4] } : { scale: [1.8, 1], rotate: 0 }}
            transition={spinning ? { repeat: Infinity, duration: .5 } : { type: "spring" }}
          >
            {pair.player2 ? "VS" : <Trophy size={34} />}
          </motion.div>
          {displayPlayers[1] ? (
            <PlayerSlot player={displayPlayers[1]} side="right" spinning={spinning} />
          ) : (
            <div className={`${styles.playerSlot} ${styles.byeSlot}`}><b>BYE</b><span>ผ่านเข้ารอบอัตโนมัติ</span></div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {!spinning && (
            <motion.div className={styles.locked} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <Check size={17} /> MATCH {String(pairIndex + 1).padStart(2, "0")} CONFIRMED
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={styles.progress}><i style={{ width: `${((pairIndex + (spinning ? .45 : 1)) / pairs.length) * 100}%` }} /></div>
      <button className={styles.skip} onClick={onFinish}>
        {complete ? <><Swords size={18} /> ดูคู่แข่งขันทั้งหมด</> : <><FastForward size={17} /> ข้ามแอนิเมชัน</>}
      </button>
    </motion.section>
  );
}

function PlayerSlot({ player, side, spinning }: { player: PublicPlayer; side: "left" | "right"; spinning: boolean }) {
  return (
    <motion.article
      key={`${side}-${player.id}`}
      className={`${styles.playerSlot} ${styles[side]}`}
      initial={{ opacity: 0, x: side === "left" ? -45 : 45 }}
      animate={{ opacity: 1, x: 0, scale: spinning ? .94 : 1 }}
      transition={{ duration: spinning ? .08 : .38, type: spinning ? "tween" : "spring" }}
    >
      <div className={styles.avatar}><Image src={player.avatarUrl} alt="" fill unoptimized /></div>
      <span>{player.department}</span>
      <h2>{player.nickname}</h2>
    </motion.article>
  );
}
