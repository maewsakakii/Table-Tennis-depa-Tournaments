"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, FastForward, Radio, Trophy, UserRound } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { PlayerReveal, PublicPlayer } from "@/lib/types";
import styles from "./matchmaking-roulette.module.css";

const SEARCH_LABELS = ["ผู้สมัครกำลังเข้าสู่เครื่องสุ่ม", "กำลังสลับสายการแข่งขัน", "กำลังค้นหาคู่แข่งของคุณ"];
const REEL_DELAYS = [70, 70, 72, 78, 88, 102, 120, 142, 168, 200, 238, 282, 334, 394, 462, 520];

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
  const [impact, setImpact] = useState(false);
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
          setImpact(true);
          return;
        }
        setFrame(nextFrame);
        advance(nextFrame);
      }, getReelDelay(currentFrame, roster.length));
    };
    advance(0);
    return () => window.clearTimeout(timer);
  }, [assetsReady, reduceMotion, reveal.matchId, roster.length, sequence.length]);

  // The impact burst (flash, shockwave, shake) is a short window right after the reel lands.
  useEffect(() => {
    if (!impact) return;
    const settle = window.setTimeout(() => setImpact(false), 720);
    return () => window.clearTimeout(settle);
  }, [impact]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onFinish]);

  const current = sequence[frame] ?? { left: player, right: reveal.opponent ?? player };
  const reelDelay = getReelDelay(frame, roster.length);
  // 0 while the reel is at full speed, 1 as it settles: drives blur, glow and speed lines.
  const charge = Math.min(1, Math.max(0, (reelDelay - 70) / (REEL_DELAYS[REEL_DELAYS.length - 1] - 70)));
  const progress = spinning ? Math.round(((frame + 1) / Math.max(sequence.length, 1)) * 100) : 100;

  return (
    <motion.section
      className={`${styles.overlay} ${impact ? styles.overlayImpact : ""}`}
      role="dialog" aria-modal="true" aria-label="ผลการจับคู่ของคุณ"
      style={{ ["--charge" as string]: spinning ? charge.toFixed(3) : "1" }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className={styles.grid} aria-hidden="true" />
      {spinning && <div className={styles.speedLines} aria-hidden="true" />}
      {impact && <><div className={styles.flash} aria-hidden="true" /><div className={styles.shockwave} aria-hidden="true" /></>}
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

        <div className={`${styles.machine} ${spinning ? styles.machineCharging : styles.machineLanded}`}>
          <div className={styles.machineTop} aria-hidden="true"><i /><span>PLAYER ROULETTE</span><i /></div>
          <div className={styles.versus}>
            {spinning ? (
              <ReelSlot player={current.left} side="left" delay={reelDelay} tick={frame % 2} />
            ) : (
              <PlayerSlot key={`final-left-${player.id}`} player={player} side="left" onSelectPlayer={onSelectPlayer} reduceMotion={Boolean(reduceMotion)} />
            )}

            <motion.div
              className={`${styles.vs} ${spinning ? styles.vsSpinning : styles.vsImpact}`}
              aria-hidden="true"
              animate={reduceMotion ? { scale: [0.9, 1], rotate: 0, opacity: [0, 1] } : spinning ? { scale: [0.9, 1.14, 0.9], rotate: [-7, 7, -7] } : { scale: [0.2, 2.1, 0.92, 1], rotate: [0, -16, 5, 0] }}
              transition={reduceMotion ? { duration: 0.3, ease: "easeOut", delay: 0.24 } : spinning ? { repeat: Infinity, duration: 0.38 } : { type: "spring", stiffness: 600, damping: 12, mass: 0.8 }}
            >
              {reveal.bye && !spinning ? <Trophy size={30} /> : "VS"}
            </motion.div>

            {spinning ? (
              <ReelSlot player={current.right} side="right" delay={reelDelay} tick={frame % 2} />
            ) : reveal.opponent ? (
              <PlayerSlot key={`final-right-${reveal.opponent.id}`} player={reveal.opponent} side="right" onSelectPlayer={onSelectPlayer} reduceMotion={Boolean(reduceMotion)} />
            ) : (
              <motion.div className={`${styles.playerSlot} ${styles.byeSlot}`} initial={reduceMotion ? { opacity: 0, scale: 0.97 } : { opacity: 0, scale: 0.72, x: 30 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={reduceMotion ? { duration: 0.32, ease: "easeOut", delay: 0.12 } : { type: "spring", stiffness: 300, damping: 18 }}>
                <Trophy size={34} /><b>BYE</b><span>ผ่านเข้ารอบอัตโนมัติ</span>
              </motion.div>
            )}
          </div>
          <div className={styles.machineBase} aria-hidden="true"><span>{spinning ? `SHUFFLING ${roster.length} PLAYERS` : "RESULT CONFIRMED"}</span></div>
        </div>
      </main>

      <div className={styles.progress} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      <button type="button" className={styles.skip} onClick={spinning ? () => { setSpinning(false); if (!reduceMotion) setImpact(true); } : onFinish}>
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

/** The reel element is never remounted: only its face swaps, so the spin stays smooth.
 *  Alternating tickA/tickB restarts the slide-in on every frame without a remount, which is
 *  what makes the swap read as a spinning strip instead of a flicker. */
function ReelSlot({ player, side, delay, tick }: { player: PublicPlayer; side: "left" | "right"; delay: number; tick: number }) {
  return (
    <article
      className={`${styles.playerSlot} ${styles.reelSlot} ${styles[side]}`}
      style={{ ["--reel-delay" as string]: `${delay}ms` }}
      aria-hidden="true"
    >
      <div className={`${styles.reelWindow}`}>
        <div className={`${styles.reelInner} ${tick === 0 ? styles.tickA : styles.tickB}`}>
          <PlayerFace player={player} />
        </div>
        <span className={styles.payline} aria-hidden="true" />
      </div>
    </article>
  );
}

function PlayerSlot({ player, side, onSelectPlayer, reduceMotion }: { player: PublicPlayer; side: "left" | "right"; onSelectPlayer?: (player: PublicPlayer) => void; reduceMotion: boolean }) {
  const playerFace = <PlayerFace player={player} showProfileHint={Boolean(onSelectPlayer)} />;
  // Cards are thrown in from off-stage and overshoot before locking, so the meeting reads as a hit.
  const motionProps = {
    initial: reduceMotion
      ? { opacity: 0, scale: 0.97 }
      : { opacity: 0, x: side === "left" ? -260 : 260, scale: 0.55, rotate: side === "left" ? -9 : 9, filter: "blur(7px)" },
    animate: { opacity: 1, x: 0, scale: 1, rotate: 0, filter: "blur(0px)" },
    transition: reduceMotion
      ? { duration: 0.32, ease: "easeOut" as const, delay: side === "left" ? 0 : 0.12 }
      : { type: "spring" as const, stiffness: 520, damping: 16, mass: 0.9, delay: 0.05 },
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
