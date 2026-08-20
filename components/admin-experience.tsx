"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CircleAlert, Copy, Eye, EyeOff, Gamepad2, KeyRound, LockKeyhole, LogOut, Radio, RefreshCw, Shuffle, Sparkles, UserPlus, Users, Wifi, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  adminSignIn,
  adminSignOut,
  adminIssuePlayerRecoveryCode,
  type AdminSessionState,
  generateHiddenAssignments,
  getAdminDraw,
  getAdminSession,
  getAllPlayers,
  getTournamentState,
  initialTournamentState,
  onlineModeLabel,
  saveLocalPlayer,
  subscribeToTournamentState,
  updateTournamentControls,
} from "@/lib/tournament-store";
import type { AdminDraw, Player, TournamentState } from "@/lib/types";
import styles from "./admin-experience.module.css";

export function AdminExperience() {
  const [session, setSession] = useState<AdminSessionState | null>(null);
  const [sessionError, setSessionError] = useState("");
  useEffect(() => {
    void getAdminSession().then(setSession).catch((cause) => {
      setSessionError(cause instanceof Error ? cause.message : "ตรวจสอบสิทธิ์ผู้ดูแลไม่สำเร็จ");
    });
  }, []);
  if (sessionError) return <SetupUnavailable message={sessionError} />;
  if (!session) return <AdminLoading />;
  if (session.configurationError) return <SetupUnavailable message="ยังไม่ได้เชื่อมต่อ Supabase ในระบบ Production จึงปิดหน้าแอดมินเพื่อความปลอดภัย" />;
  if (!session.active) return <AdminLogin onSuccess={() => setSession({ active: true, demo: false, configurationError: false })} />;
  return <AdminDashboard demo={session.demo} onSignOut={() => setSession({ active: false, demo: false, configurationError: false })} />;
}

function AdminLoading() { return <main className={styles.authPage}><div className={styles.loader} /><span>กำลังเปิด Control Room</span></main>; }

function SetupUnavailable({ message }: { message: string }) {
  return <main className={styles.authPage}><div className={styles.authGrid} /><Link href="/" className={styles.backLink}><ArrowLeft size={17} /> กลับหน้าผู้เล่น</Link><section className={styles.loginPanel} role="alert"><div className={styles.controlMark}><CircleAlert size={25} /></div><span className={styles.kicker}>SETUP REQUIRED</span><h1>Admin<br /><em>Unavailable</em></h1><p>{message}</p><div className={styles.setupHelp}><b>ตรวจสอบการตั้งค่า</b><span>ตรวจ Environment Variables, Supabase migration และการเชื่อมต่อเครือข่าย แล้วโหลดหน้าใหม่</span></div></section></main>;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { await adminSignIn(email, password); onSuccess(); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "เข้าสู่ระบบไม่สำเร็จ"; setError(message.toLowerCase().includes("invalid login credentials") ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : message); }
    finally { setLoading(false); }
  }
  return <main className={styles.authPage}><div className={styles.authGrid} /><Link href="/" className={styles.backLink}><ArrowLeft size={17} /> กลับหน้าผู้เล่น</Link><motion.section className={styles.loginPanel} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}><div className={styles.controlMark}><Gamepad2 size={26} /></div><span className={styles.kicker}>AUTHORIZED PERSONNEL ONLY</span><h1>Tournament<br /><em>Control Room</em></h1><p>เข้าสู่ระบบด้วยบัญชีผู้จัดที่สร้างไว้ใน Supabase Authentication</p><form onSubmit={submit}><label><span>อีเมลแอดมิน</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your-email@example.com" autoComplete="email" /></label><label><span>รหัสผ่าน</span><div className={styles.passwordInput}><input type={showPassword ? "text" : "password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>{error && <div className={styles.authError}><CircleAlert size={16} />{error}</div>}<button className={styles.loginButton} disabled={loading}><LockKeyhole size={18} />{loading ? "กำลังตรวจสอบ..." : "เข้าสู่ Control Room"}</button></form><div className={styles.setupHelp}><b>ตั้งค่าครั้งแรก</b><span>สร้าง User ใน Supabase Authentication และเพิ่มอีเมลเดียวกันในตาราง admin_emails</span></div></motion.section></main>;
}

function AdminDashboard({ demo, onSignOut }: { demo: boolean; onSignOut: () => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournament, setTournament] = useState<TournamentState>(initialTournamentState);
  const [draw, setDraw] = useState<AdminDraw>({ version: 0, pairs: [] });
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [recoveryTarget, setRecoveryTarget] = useState<Player | null>(null);
  const [issuedRecovery, setIssuedRecovery] = useState<{ playerId: string; recoveryCode: string } | null>(null);
  const [issuingRecovery, setIssuingRecovery] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [loadedPlayers, loadedState] = await Promise.all([getAllPlayers(), getTournamentState()]);
      setPlayers(loadedPlayers); setTournament(loadedState);
      if (loadedState.status === "locked") setDraw(await getAdminDraw(loadedState.version));
      else setDraw({ version: loadedState.version, pairs: [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void loadData(); }, 0); return () => window.clearTimeout(timer); }, [loadData]);
  useEffect(() => subscribeToTournamentState((state) => { setTournament(state); if (state.status === "locked") void getAdminDraw(state.version).then(setDraw).catch(() => undefined); }), []);

  const playerMap = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  async function mutate(action: () => Promise<TournamentState | AdminDraw>) {
    setMutating(true); setError("");
    try { await action(); await loadData(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกคำสั่งไม่สำเร็จ"); }
    finally { setMutating(false); }
  }

  async function signOut() { await adminSignOut(); onSignOut(); }

  async function issueRecoveryCode() {
    if (!recoveryTarget) return;
    setIssuingRecovery(true); setError("");
    try { setIssuedRecovery(await adminIssuePlayerRecoveryCode(recoveryTarget.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ออกรหัสกู้คืนไม่สำเร็จ"); setRecoveryTarget(null); }
    finally { setIssuingRecovery(false); }
  }

  function closeRecoverySheet() { setRecoveryTarget(null); setIssuedRecovery(null); }

  function addDemoPlayers() {
    const names = ["พี่แอม", "นัท", "ปิง", "เจ", "มุก", "ต้น", "แพรว", "บอส"];
    const teams = ["การตลาด", "ไอที / ผลิตภัณฑ์", "ฝ่ายขาย", "ปฏิบัติการ"];
    const palette = ["65e5ff", "ff7146", "d3ff48", "e3a6ff"];
    const samples: Player[] = names.map((nickname, index) => ({ id: `DT-${String(index + 1).padStart(2, "0")}`, nickname, department: teams[index % teams.length], avatarUrl: demoAvatar(nickname, palette[index % palette.length]), registeredAt: new Date(Date.now() - index * 60000).toISOString(), status: "waiting" }));
    samples.forEach((player) => saveLocalPlayer(player));
    setPlayers(samples);
  }

  return <main className={styles.dashboard}>
    <header className={styles.topbar}><div className={styles.adminBrand}><span><Gamepad2 size={20} /></span><div><b>depa TABLE TENNIS</b><small>CONTROL ROOM · 2026</small></div></div><div className={styles.topActions}><Link href="/" aria-label="หน้าผู้เล่น"><ArrowLeft size={18} /></Link><button onClick={signOut} aria-label="ออกจากระบบ"><LogOut size={18} /></button></div></header>
    <div className={styles.dashboardBody}>
      <section className={styles.dashboardTitle}><div><span className={styles.kicker}>TOURNAMENT OPERATIONS</span><h1>Match Control</h1><p>ล็อกคู่ไว้หลังบ้าน แล้วเปิดให้นักแข่งสุ่มดูคู่ของตัวเองเมื่อพร้อม</p></div><div className={`${styles.modeBadge} ${demo ? styles.demo : ""}`}><Wifi size={14} />{onlineModeLabel()}</div></section>
      {demo && <div className={styles.demoNotice}><Sparkles size={17} /><div><b>กำลังใช้ Local Demo Mode</b><span>ข้อมูลทำงานเฉพาะเบราว์เซอร์นี้ ไม่ใช่ระบบออนไลน์</span></div></div>}
      {error && <div className={styles.errorBanner}><CircleAlert size={17} />{error}</div>}
      <section className={styles.metrics}><div><span>REGISTERED</span><b>{players.length}</b><small>PLAYERS</small></div><div><span>ROUND 01</span><b>{Math.ceil(players.length / 2)}</b><small>MATCHES</small></div><div><span>REVEAL</span><b className={tournament.revealOpen ? styles.onlineText : styles.offlineText}>{tournament.revealOpen ? "OPEN" : "LOCK"}</b><small>{tournament.status.toUpperCase()}</small></div></section>

      <section className={styles.controlPanel}><div className={styles.sectionHead}><div><span>EVENT CONTROLS</span><h2>ตั้งค่าสถานะการแข่งขัน</h2></div><Radio size={20} /></div>
        <ControlToggle title="เปิดรับลงทะเบียน" description={tournament.status === "locked" ? "หากเปิดเพิ่ม ต้องสุ่มและล็อกคู่ใหม่เพื่อรวมผู้เล่นล่าสุด" : "ปิดก่อนสุ่มเพื่อไม่ให้รายชื่อเปลี่ยนระหว่างจัดคู่"} checked={tournament.registrationOpen} disabled={mutating} onChange={(checked) => void mutate(() => updateTournamentControls({ registrationOpen: checked, ...(checked ? { revealOpen: false } : {}) }))} />
        <ControlToggle title="เปิดให้ผู้เล่นดูคู่แข่ง" description={tournament.registrationOpen ? "ปิดรับสมัครก่อน จึงจะเปิดให้ดูคู่แข่งได้" : "ผู้เล่นแต่ละคนจะเห็นเฉพาะคู่ของตัวเองผ่านแอนิเมชัน"} checked={tournament.revealOpen} disabled={mutating || tournament.registrationOpen || draw.pairs.length === 0} onChange={(checked) => void mutate(() => updateTournamentControls({ revealOpen: checked }))} accent />
        <div className={styles.drawVisual}><Shuffle size={31} /><div><b>{draw.pairs.length ? `ล็อกแล้ว ${draw.pairs.length} คู่` : "ยังไม่ได้ล็อกคู่"}</b><span>ผลคู่ทั้งหมดเป็นความลับและดูได้เฉพาะหน้าแอดมิน</span></div></div>
        <button className={styles.drawButton} onClick={() => void mutate(generateHiddenAssignments)} disabled={players.length < 2 || mutating || loading}><Shuffle size={19} />{mutating ? "กำลังบันทึก..." : draw.pairs.length ? "สุ่มและล็อกคู่ใหม่" : "สุ่มและล็อกคู่หลังบ้าน"}</button>
        {players.length < 2 && <p className={styles.drawHint}>ต้องมีผู้เล่นอย่างน้อย 2 คนเพื่อเริ่มจับคู่</p>}
      </section>

      {draw.pairs.length > 0 && <PairSummary draw={draw} playerMap={playerMap} />}
      <section className={styles.rosterPanel}><div className={styles.rosterHead}><div><span>PLAYER ROSTER</span><h2>ผู้สมัครทั้งหมด <i>{players.length}</i></h2></div><button onClick={loadData} disabled={loading} aria-label="โหลดรายชื่อใหม่"><RefreshCw size={17} className={loading ? styles.spinning : ""} /></button></div>{players.length ? <div className={styles.playerList}>{players.map((player, index) => <PlayerRow player={player} index={index} key={player.id} onIssueRecovery={() => { setRecoveryTarget(player); setIssuedRecovery(null); }} />)}</div> : <div className={styles.emptyRoster}><Users size={30} /><b>ยังไม่มีผู้สมัคร</b><span>รายชื่อจะปรากฏหลังมีผู้เล่นลงทะเบียน</span>{demo && <button onClick={addDemoPlayers}><UserPlus size={16} /> เพิ่มผู้เล่นตัวอย่าง 8 คน</button>}</div>}</section>
    </div>
    {recoveryTarget && <AdminRecoverySheet player={recoveryTarget} issued={issuedRecovery} loading={issuingRecovery} onIssue={() => void issueRecoveryCode()} onClose={closeRecoverySheet} />}
  </main>;
}

function ControlToggle({ title, description, checked, disabled, onChange, accent = false }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; accent?: boolean }) {
  return <label className={`${styles.controlToggle} ${disabled ? styles.controlToggleDisabled : ""}`}><div><b>{title}</b><span>{description}</span></div><input className={styles.toggleInput} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className={`${styles.switch} ${checked ? styles.switchOn : ""} ${accent ? styles.switchAccent : ""}`} aria-hidden="true"><i /></span></label>;
}

function PairSummary({ draw, playerMap }: { draw: AdminDraw; playerMap: Map<string, Player> }) {
  return <section className={styles.pairPanel}><div className={styles.sectionHead}><div><span>ADMIN ONLY · DRAW V{draw.version}</span><h2>ตัวอย่างคู่ลับหลังบ้าน</h2></div><Eye size={20} /></div><p className={styles.privateNote}><LockKeyhole size={14} /> หน้าผู้เล่นยังไม่เห็นรายชื่อนี้</p><div className={styles.pairList}>{draw.pairs.map((pair, index) => { const first = playerMap.get(pair.player1Id); const second = pair.player2Id ? playerMap.get(pair.player2Id) : null; return <div className={styles.pairRow} key={pair.id}><small>{String(index + 1).padStart(2, "0")}</small><span>{first?.nickname ?? pair.player1Id}</span><b>{second ? "VS" : "BYE"}</b><span>{second?.nickname ?? "ชนะบาย"}</span></div>; })}</div></section>;
}

function PlayerRow({ player, index, onIssueRecovery }: { player: Player; index: number; onIssueRecovery: () => void }) { return <article className={styles.playerRow}><small>{String(index + 1).padStart(2, "0")}</small><div className={styles.rowAvatar}><Image src={player.avatarUrl} alt="" fill unoptimized /></div><div><b>{player.nickname}</b><span>{player.id} · {player.department}</span></div><button className={styles.recoveryAction} type="button" onClick={onIssueRecovery} aria-label={`ออกรหัสกู้คืนใหม่ให้ ${player.nickname}`}><KeyRound size={16} /><span>รหัส</span></button></article>; }

function AdminRecoverySheet({ player, issued, loading, onIssue, onClose }: { player: Player; issued: { playerId: string; recoveryCode: string } | null; loading: boolean; onIssue: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() { if (!issued) return; try { await navigator.clipboard.writeText(issued.recoveryCode); setCopied(true); } catch { setCopied(false); } }
  return <div className={styles.sheetBackdrop}><motion.section className={styles.recoverySheet} role="dialog" aria-modal="true" aria-labelledby="admin-recovery-title" initial={{ y: "100%" }} animate={{ y: 0 }}><button className={styles.sheetClose} type="button" onClick={onClose} aria-label="ปิด"><X size={20} /></button><div className={styles.recoveryMark}><KeyRound size={24} /></div><span className={styles.kicker}>PLAYER RECOVERY</span><h2 id="admin-recovery-title">{issued ? "รหัสใหม่พร้อมส่งให้ผู้เล่น" : `ออกรหัสใหม่ให้ ${player.nickname}`}</h2>{issued ? <><div className={styles.issuedCode}><span>{issued.playerId}</span><strong>{issued.recoveryCode}</strong></div><p className={styles.recoveryWarning}>รหัสนี้แสดงเพียงครั้งเดียว ส่งให้ผู้เล่นผ่านช่องทางส่วนตัว และอย่าแชร์ในกลุ่มสาธารณะ</p><button className={styles.copyButton} type="button" onClick={copyCode}><Copy size={18} />{copied ? "คัดลอกแล้ว" : "คัดลอกรหัส"}</button></> : <><p className={styles.recoveryWarning}>การยืนยันจะทำให้รหัสเดิมใช้ไม่ได้ทันที ใช้เมื่อผู้เล่นทำรหัสหายหรือเป็นบัญชีเดิมที่ยังไม่มีรหัสเท่านั้น</p><button className={styles.issueButton} type="button" onClick={onIssue} disabled={loading}><KeyRound size={18} />{loading ? "กำลังออกรหัส..." : "ยืนยันและหมุนรหัสใหม่"}</button></>}<button className={styles.cancelButton} type="button" onClick={onClose}>{issued ? "ปิดหน้าต่าง" : "ยกเลิก"}</button></motion.section></div>;
}

function demoAvatar(name: string, color: string) { const initial = name.replace("พี่", "").slice(0, 1); const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#10211c"/><circle cx="250" cy="205" r="96" fill="#${color}" opacity=".82"/><path d="M90 500c12-122 79-183 160-183s148 61 160 183" fill="#${color}" opacity=".55"/><text x="250" y="245" text-anchor="middle" font-size="100" font-family="sans-serif" font-weight="700" fill="#06100e">${initial}</text></svg>`; return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
