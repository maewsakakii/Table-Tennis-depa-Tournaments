"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Gamepad2,
  LockKeyhole,
  LogOut,
  Radio,
  RefreshCw,
  Shuffle,
  Sparkles,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MatchmakingRoulette } from "@/components/matchmaking-roulette";
import {
  adminSignOut,
  getAdminSession,
  getAllPlayers,
  getTournamentState,
  initialTournamentState,
  onlineModeLabel,
  requestAdminMagicLink,
  saveTournamentState,
  subscribeToTournamentState,
  toPublicPlayer,
} from "@/lib/tournament-store";
import type { MatchPair, Player, TournamentState } from "@/lib/types";
import styles from "./admin-experience.module.css";

export function AdminExperience() {
  const [session, setSession] = useState<{ active: boolean; demo: boolean } | null>(null);

  useEffect(() => {
    void getAdminSession().then(setSession);
  }, []);

  if (!session) return <AdminLoading />;
  if (!session.active) return <AdminLogin />;
  return <AdminDashboard demo={session.demo} onSignOut={() => setSession({ active: false, demo: false })} />;
}

function AdminLoading() {
  return <main className={styles.authPage}><div className={styles.loader} /><span>กำลังเปิด Control Room</span></main>;
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await requestAdminMagicLink(email);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <div className={styles.authGrid} />
      <Link href="/" className={styles.backLink}><ArrowLeft size={17} /> กลับหน้าผู้เล่น</Link>
      <motion.section className={styles.loginPanel} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className={styles.controlMark}><Gamepad2 size={26} /></div>
        <span className={styles.kicker}>AUTHORIZED PERSONNEL ONLY</span>
        <h1>Tournament<br /><em>Control Room</em></h1>
        <p>ไม่ต้องใช้รหัสผ่าน ระบบจะส่ง Magic Link ไปยังอีเมลผู้จัดที่ได้รับอนุญาต</p>
        {sent ? (
          <div className={styles.magicSent}><CheckCircle2 size={27} /><b>ส่งลิงก์เข้าแอดมินแล้ว</b><span>เปิดอีเมล {email} แล้วกดลิงก์เพื่อกลับเข้าสู่ Control Room</span><button onClick={() => setSent(false)}>ส่งไปอีเมลอื่น</button></div>
        ) : (
          <form onSubmit={submit}>
            <label><span>อีเมลแอดมิน</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your-email@example.com" /></label>
            {error && <div className={styles.authError}><CircleAlert size={16} />{error}</div>}
            <button className={styles.loginButton} disabled={loading}><LockKeyhole size={18} />{loading ? "กำลังส่งลิงก์..." : "ส่ง Magic Link เข้าแอดมิน"}</button>
          </form>
        )}
      </motion.section>
    </main>
  );
}

function AdminDashboard({ demo, onSignOut }: { demo: boolean; onSignOut: () => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournament, setTournament] = useState<TournamentState>(initialTournamentState);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [loadedPlayers, loadedState] = await Promise.all([getAllPlayers(), getTournamentState()]);
      setPlayers(loadedPlayers);
      setTournament(loadedState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadData]);
  useEffect(() => subscribeToTournamentState(setTournament), []);

  const publicPlayers = useMemo(() => players.map(toPublicPlayer), [players]);

  async function startRoulette() {
    if (players.length < 2) return;
    setDrawing(true);
    setError("");
    const shuffled = [...publicPlayers];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    const pairs: MatchPair[] = [];
    for (let index = 0; index < shuffled.length; index += 2) {
      pairs.push({ id: crypto.randomUUID(), player1: shuffled[index], player2: shuffled[index + 1] ?? null });
    }
    const nextState: TournamentState = {
      version: tournament.version + 1,
      status: "drawing",
      roster: shuffled,
      pairs,
      startedAt: new Date().toISOString(),
    };
    try {
      await saveTournamentState(nextState);
      setTournament(nextState);
    } catch (cause) {
      setDrawing(false);
      setError(cause instanceof Error ? cause.message : "เริ่มจับคู่ไม่สำเร็จ");
    }
  }

  async function finishRoulette() {
    const readyState = { ...tournament, status: "ready" as const };
    setDrawing(false);
    setTournament(readyState);
    try { await saveTournamentState(readyState); } catch { /* UI keeps the generated result visible. */ }
  }

  async function signOut() {
    await adminSignOut();
    onSignOut();
  }

  function addDemoPlayers() {
    const names = ["พี่แอม", "นัท", "ปิง", "เจ", "มุก", "ต้น", "แพรว", "บอส"];
    const teams = ["การตลาด", "ไอที / ผลิตภัณฑ์", "ฝ่ายขาย", "ปฏิบัติการ"];
    const palette = ["65e5ff", "ff7146", "d3ff48", "e3a6ff"];
    const samples: Player[] = names.map((nickname, index) => ({
      id: `demo-${index + 1}`,
      nickname,
      department: teams[index % teams.length],
      avatarUrl: demoAvatar(nickname, palette[index % palette.length]),
      registeredAt: new Date(Date.now() - index * 60000).toISOString(),
      status: "waiting",
    }));
    setPlayers((current) => [...current.filter((player) => !player.id.startsWith("demo-")), ...samples]);
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.topbar}>
        <div className={styles.adminBrand}><span><Gamepad2 size={20} /></span><div><b>depa TABLE TENNIS</b><small>CONTROL ROOM · 2026</small></div></div>
        <div className={styles.topActions}><Link href="/" aria-label="หน้าผู้เล่น"><ArrowLeft size={18} /></Link><button onClick={signOut} aria-label="ออกจากระบบ"><LogOut size={18} /></button></div>
      </header>

      <div className={styles.dashboardBody}>
        <section className={styles.dashboardTitle}>
          <div><span className={styles.kicker}>TOURNAMENT OPERATIONS</span><h1>Match Control</h1><p>ตรวจรายชื่อและปล่อยสัญญาณจับคู่ไปยังหน้าผู้เล่นทุกเครื่อง</p></div>
          <div className={`${styles.modeBadge} ${demo ? styles.demo : ""}`}><Wifi size={14} />{onlineModeLabel()}</div>
        </section>

        {demo && <div className={styles.demoNotice}><Sparkles size={17} /><div><b>กำลังใช้ Local Demo Mode</b><span>เชื่อม Supabase เพื่อให้ข้อมูลทำงานข้ามเครื่องแบบออนไลน์</span></div></div>}
        {error && <div className={styles.errorBanner}><CircleAlert size={17} />{error}</div>}

        <section className={styles.metrics}>
          <div><span>REGISTERED</span><b>{players.length}</b><small>PLAYERS</small></div>
          <div><span>ROUND 01</span><b>{Math.ceil(players.length / 2)}</b><small>MATCHES</small></div>
          <div><span>SYSTEM</span><b className={styles.onlineText}>LIVE</b><small>READY</small></div>
        </section>

        <section className={styles.controlPanel}>
          <div className={styles.sectionHead}><div><span>DRAW CONSOLE</span><h2>ระบบสุ่มจับคู่</h2></div><Radio size={20} /></div>
          <div className={styles.drawVisual}><Shuffle size={31} /><div><b>{tournament.status === "ready" ? "จับคู่ล่าสุดเสร็จแล้ว" : "พร้อมปล่อยสัญญาณ"}</b><span>Avatar ของผู้เล่นจะหมุนแบบ Slot Machine บนทุกหน้าจอ</span></div></div>
          <button className={styles.drawButton} onClick={startRoulette} disabled={players.length < 2 || drawing || loading}><Shuffle size={19} />{drawing ? "กำลังจับคู่..." : tournament.status === "ready" ? "สุ่มจับคู่ใหม่" : "เริ่ม Matchmaking Roulette"}</button>
          {players.length < 2 && <p className={styles.drawHint}>ต้องมีผู้เล่นอย่างน้อย 2 คนเพื่อเริ่มจับคู่</p>}
        </section>

        {tournament.pairs.length > 0 && <PairSummary tournament={tournament} />}

        <section className={styles.rosterPanel}>
          <div className={styles.rosterHead}><div><span>PLAYER ROSTER</span><h2>ผู้สมัครทั้งหมด <i>{players.length}</i></h2></div><button onClick={loadData} disabled={loading}><RefreshCw size={17} className={loading ? styles.spinning : ""} /></button></div>
          {players.length ? (
            <div className={styles.playerList}>{players.map((player, index) => <PlayerRow player={player} index={index} key={player.id} />)}</div>
          ) : (
            <div className={styles.emptyRoster}><Users size={30} /><b>ยังไม่มีผู้สมัคร</b><span>รายชื่อจะปรากฏที่นี่หลังมีผู้เล่นลงทะเบียน</span>{demo && <button onClick={addDemoPlayers}><UserPlus size={16} /> เพิ่มผู้เล่นตัวอย่าง 8 คน</button>}</div>
          )}
          {demo && players.length > 0 && <button className={styles.demoAdd} onClick={addDemoPlayers}><UserPlus size={16} /> เติมผู้เล่นตัวอย่าง</button>}
        </section>
      </div>

      <AnimatePresence>{drawing && tournament.status === "drawing" && <MatchmakingRoulette state={tournament} onFinish={finishRoulette} />}</AnimatePresence>
    </main>
  );
}

function PairSummary({ tournament }: { tournament: TournamentState }) {
  return <section className={styles.pairPanel}><div className={styles.sectionHead}><div><span>DRAW RESULT · V{tournament.version}</span><h2>คู่แข่งขันรอบแรก</h2></div><CheckCircle2 size={20} /></div><div className={styles.pairList}>{tournament.pairs.map((pair, index) => <div className={styles.pairRow} key={pair.id}><small>{String(index + 1).padStart(2, "0")}</small><span>{pair.player1.nickname}</span><b>{pair.player2 ? "VS" : "BYE"}</b><span>{pair.player2?.nickname ?? "ชนะบาย"}</span></div>)}</div></section>;
}

function PlayerRow({ player, index }: { player: Player; index: number }) {
  return <article className={styles.playerRow}><small>{String(index + 1).padStart(2, "0")}</small><div className={styles.rowAvatar}><Image src={player.avatarUrl} alt="" fill unoptimized /></div><div><b>{player.nickname}</b><span>{player.department}</span></div><i>READY</i></article>;
}

function demoAvatar(name: string, color: string) {
  const initial = name.replace("พี่", "").slice(0, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#10211c"/><circle cx="250" cy="205" r="96" fill="#${color}" opacity=".82"/><path d="M90 500c12-122 79-183 160-183s148 61 160 183" fill="#${color}" opacity=".55"/><text x="250" y="245" text-anchor="middle" font-size="100" font-family="sans-serif" font-weight="700" fill="#06100e">${initial}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
