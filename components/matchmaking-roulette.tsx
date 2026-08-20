"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, FastForward, Radio, Trophy, UserRound } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { PlayerReveal, PublicPlayer } from "@/lib/types";
import styles from "./matchmaking-roulette.module.css";

const SEARCH_LABELS = ["ผู้สมัครกำลังเข้าสู่เครื่องสุ่ม", "กำลังสลับสายการแข่งขัน", "กำลังค้นหาคู่แข่งของคุณ"];
const REEL_DELAYS = [70, 70, 70, 85, 100, 120, 145, 175, 210, 260, 320, 400, 460, 520];

type ReelFrame = { left: PublicPlayer; right: PublicPlayer };

type MatchmakingRouletteProps = {
  player: PublicPlayer;
  reveal: PlayerReveal;
  candidates: PublicPlayer[];
  onFinish: () => void;
  onSelectPlayer?: (player: PublicPlayer) => void;
};

/** The moving reel is presentational; the final pairing always comes from `reveal`. */
export function MatchmakingRoulette({
  player,
  reveal,
  candidates,
  onFinish,
  onSelectPlayer,
}: MatchmakingRouletteProps) {
  const reduceMotion = useReducedMotion();
  const roster = useMemo(
    () => sanitizeCandidates(candidates, player, reveal.opponent),
    [candidates, player, reveal.opponent],
  );
  const sequence = useMemo(
    () => buildReelSequence(roster, reveal.matchId),
    [roster, reveal.matchId],
  );
  const avatarSignature = useMemo(() => roster.map((candidate) => candidate.avatarUrl).join("\n"), [roster]);
  const [preloadedSignature, setPreloadedSignature] = useState("");
  const [spinning, setSpinning] = useState(!reduceMotion);
  const [frame, setFrame] = useState(0);
  const assetsReady = Boolean(reduceMotion) || preloadedSignature === avatarSignature;

  useEffect(() => {
    if (reduceMotion) return;
    let cancelled = false;
    void Promise.all(roster.map((candidate) => preloadAvatar(candidate.avatarUrl))).then(() => {
      if (!cancelled) setPreloadedSignature(avatarSignature);
    });
    return () => { cancelled = true; };
  }, [avatarSignature, reduceMotion, roster]);

  useEffect(() => {
    if (!assetsReady) return;
    if (reduceMotion || sequence.length === 0) {
      const finishImmediately = window.setTimeout(() => setSpinning(false), 0);
      return () => window.clearTimeout(finishImmediately);
    }

    let timer = 0;
    const advance = (currentFrame: number) => {
      timer = window.setTimeout(() => {
        const nextFrame = currentFrame + 1;
        if (nextFrame >= sequence.length) {
          setSpinning(false);
          return;
        }
        setFrame(nextFrame);
        advance(nextFrame);
      }, getReelDelay(currentFrame, roster.length));
    };
    advance(0);
    return () => window.clearTimeout(timer);
  }, [assetsReady, reduceMotion, reveal.matchId, roster.length, sequence.length]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onFinish]);

  const current = sequence[frame] ?? { left: player, right: reveal.opponent ?? player };
  const progress = spinning ? Math.round(((frame + 1) / Math.max(sequence.length, 1)) * 100) : 100;

  return (
    <motion.section className={styles.overlay} role="dialog" aria-modal="true" aria-label="ผลการจับคู่ของคุณ" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.grid} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.live}><Radio size={13} /> LIVE ROULETTE</div>
        <b>depa TABLE TENNIS 2026</b>
        <span>{player.id}</span>
      </header>

      <main className={styles.stage}>
        <div className={styles.kicker}>{spinning ? "MATCHMAKING IN PROGRESS" : "MATCH FOUND"}</div>
        <h1>{spinning ? SEARCH_LABELS[frame % SEARCH_LABELS.length] : reveal.bye ? "คุณชนะบายรอบแรก" : "พบคู่แข่งของคุณแล้ว"}</h1>
        <p className={styles.srOnly} role="status" aria-live="polite">
          {spinning ? "กำลังสุ่มรายชื่อผู้สมัคร" : reveal.bye ? "คุณผ่านเข้ารอบถัดไปอัตโนมัติ" : `คู่แข่งของคุณคือ ${reveal.opponent?.nickname ?? ""}`}
        </p>

        <div className={styles.machine}>
          <div className={styles.machineTop} aria-hidden="true"><i /><span>PLAYER ROULETTE</span><i /></div>
          <div className={styles.versus}>
            <AnimatePresence mode="popLayout" initial={false}>
              {spinning ? (
                <ReelSlot key={`left-${frame}-${current.left.id}`} player={current.left} side="left" />
              ) : (
                <PlayerSlot key={`final-left-${player.id}`} player={player} side="left" onSelectPlayer={onSelectPlayer} reduceMotion={Boolean(reduceMotion)} />
              )}
            </AnimatePresence>

            <motion.div
              className={`${styles.vs} ${spinning ? styles.vsSpinning : styles.vsImpact}`}
              aria-hidden="true"
              animate={reduceMotion ? { scale: 1, rotate: 0 } : spinning ? { scale: [0.92, 1.1, 0.92], rotate: [-5, 5, -5] } : { scale: [0.35, 1.65, 1], rotate: [0, -8, 0] }}
              transition={reduceMotion ? { duration: 0 } : spinning ? { repeat: Infinity, duration: 0.42 } : { type: "spring", stiffness: 420, damping: 15 }}
            >
              {reveal.bye && !spinning ? <Trophy size={30} /> : "VS"}
            </motion.div>

            <AnimatePresence mode="popLayout" initial={false}>
              {spinning ? (
                <ReelSlot key={`right-${frame}-${current.right.id}`} player={current.right} side="right" />
              ) : reveal.opponent ? (
                <PlayerSlot key={`final-right-${reveal.opponent.id}`} player={reveal.opponent} side="right" onSelectPlayer={onSelectPlayer} reduceMotion={Boolean(reduceMotion)} />
              ) : (
                <motion.div key="bye" className={`${styles.playerSlot} ${styles.byeSlot}`} initial={reduceMotion ? false : { opacity: 0, scale: 0.72, x: 30 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 18 }}>
                  <Trophy size={34} /><b>BYE</b><span>ผ่านเข้ารอบอัตโนมัติ</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className={styles.machineBase} aria-hidden="true"><span>{spinning ? "SHUFFLING ALL PLAYERS" : "RESULT CONFIRMED"}</span></div>
        </div>
      </main>

      <div className={styles.progress} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      <button type="button" className={styles.skip} onClick={spinning ? () => setSpinning(false) : onFinish}>
        {spinning ? <><FastForward size={18} /> ข้ามแอนิเมชัน</> : <><Check size={18} /> กลับหน้า Lobby</>}
      </button>
    </motion.section>
  );
}

function sanitizeCandidates(candidates: PublicPlayer[], player: PublicPlayer, opponent: PublicPlayer | null) {
  const unique = new Map<string, PublicPlayer>();
  const add = (candidate: PublicPlayer | null) => {
    if (!candidate) return;
    const id = candidate.id.trim();
    const nickname = candidate.nickname.trim();
    const department = candidate.department.trim();
    const avatarUrl = candidate.avatarUrl.trim();
    if (!id || !nickname || !department || !avatarUrl || unique.has(id)) return;
    unique.set(id, { id, nickname, department, avatarUrl });
  };
  candidates.forEach(add);
  add(player);
  add(opponent);
  return [...unique.values()];
}

function buildReelSequence(roster: PublicPlayer[], seed: string): ReelFrame[] {
  if (roster.length === 0) return [];
  const sequence: ReelFrame[] = [];
  const offset = Math.max(1, hashSeed(seed) % roster.length);

  // Coverage lap: each real candidate is shown at least once before the slowdown.
  for (const candidate of roster) {
    const index = roster.findIndex((item) => item.id === candidate.id);
    sequence.push({ left: candidate, right: roster[(index + offset) % roster.length] });
  }

  // Slowdown lap: deterministic faces keep the spectacle stable across re-renders.
  for (let index = 0; index < REEL_DELAYS.length; index += 1) {
    const leftIndex = (index * 3 + offset) % roster.length;
    const rightIndex = (leftIndex + index + 1) % roster.length;
    sequence.push({ left: roster[leftIndex], right: roster[rightIndex] });
  }
  return sequence;
}

function getReelDelay(frame: number, coverageFrames: number) {
  if (frame < coverageFrames) return 70;
  return REEL_DELAYS[Math.min(frame - coverageFrames, REEL_DELAYS.length - 1)];
}

function hashSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

function ReelSlot({ player, side }: { player: PublicPlayer; side: "left" | "right" }) {
  return (
    <motion.article className={`${styles.playerSlot} ${styles.reelSlot} ${styles[side]}`} aria-hidden="true" initial={{ opacity: 0, y: side === "left" ? -38 : 38, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: side === "left" ? 38 : -38, scale: 0.94 }} transition={{ duration: 0.075, ease: "linear" }}>
      <PlayerFace player={player} />
    </motion.article>
  );
}

function PlayerSlot({ player, side, onSelectPlayer, reduceMotion }: { player: PublicPlayer; side: "left" | "right"; onSelectPlayer?: (player: PublicPlayer) => void; reduceMotion: boolean }) {
  const playerFace = <PlayerFace player={player} showProfileHint={Boolean(onSelectPlayer)} />;
  const motionProps = {
    initial: reduceMotion ? false : { opacity: 0, x: side === "left" ? -110 : 110, scale: 0.72 },
    animate: { opacity: 1, x: 0, scale: 1 },
    transition: reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 360, damping: 17, delay: 0.08 },
  };

  if (onSelectPlayer) {
    return (
      <motion.button type="button" aria-label={`ดูโปรไฟล์ ${player.nickname}`} className={`${styles.playerSlot} ${styles.finalSlot} ${styles[side]}`} onClick={() => onSelectPlayer?.(player)} {...motionProps}>
        {playerFace}
      </motion.button>
    );
  }

  return <motion.article className={`${styles.playerSlot} ${styles.finalSlot} ${styles[side]}`} {...motionProps}>{playerFace}</motion.article>;
}

function preloadAvatar(url: string) {
  return new Promise<void>((resolve) => {
    const image = new window.Image();
    const finish = () => resolve();
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
    if (image.complete) void image.decode?.().catch(() => undefined).finally(finish);
  });
}

function PlayerFace({ player, showProfileHint = false }: { player: PublicPlayer; showProfileHint?: boolean }) {
  return (
    <>
      <div className={styles.avatar}>
        <Image src={player.avatarUrl} alt={`รูปของ ${player.nickname}`} fill sizes="(max-width: 759px) 42vw, 340px" unoptimized />
        <span className={styles.scanLine} aria-hidden="true" />
      </div>
      <div className={styles.playerMeta}>
        <span>{player.id} · {player.department}</span>
        <h2>{player.nickname}</h2>
        {showProfileHint && <small><UserRound size={13} /> ดูโปรไฟล์</small>}
      </div>
    </>
  );
}
