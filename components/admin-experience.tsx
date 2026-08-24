"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CircleAlert, Copy, Eye, EyeOff, Gamepad2, ImagePlus, KeyRound, LockKeyhole, LogOut, Pencil, Radio, RefreshCw, Shuffle, Sparkles, Trash2, Trophy, Users, Wifi, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PlayerProfileSheet } from "@/components/player-profile-sheet";
import { ScoreEntrySheet } from "@/components/score-entry-sheet";
import { TournamentBracket } from "@/components/tournament-bracket";
import {
  adminSignIn,
  adminSignOut,
  adminIssuePlayerRecoveryCode,
  adminDeletePlayer,
  adminUpdatePlayerProfile,
  adminUpdatePlayerAvatar,
  adminSetPlayerGender,
  type AdminSessionState,
  generateTournamentBracket,
  getAdminSession,
  getAdminTournamentSnapshot,
  getAllPlayers,
  getTournamentState,
  initialTournamentState,
  onlineModeLabel,
  recordMatchScore,
  subscribeToTournamentState,
  updateMatchDate,
  updateTournamentControls,
} from "@/lib/tournament-store";
import { isAcceptedAvatar } from "@/lib/local-avatar";
import type { BracketMatch, Division, Player, PublicPlayer, TournamentSnapshot, TournamentState } from "@/lib/types";
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
  const [snapshot, setSnapshot] = useState<TournamentSnapshot>({ version: 0, bracketRevision: 0, roundCount: 0, matches: [], players: [] });
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [recoveryTarget, setRecoveryTarget] = useState<Player | null>(null);
  const [issuedRecovery, setIssuedRecovery] = useState<{ playerId: string; recoveryCode: string } | null>(null);
  const [issuingRecovery, setIssuingRecovery] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Player | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [editTarget, setEditTarget] = useState<Player | null>(null);
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState(false);
  const [scoreTarget, setScoreTarget] = useState<BracketMatch | null>(null);
  const [profileTarget, setProfileTarget] = useState<PublicPlayer | null>(null);
  const [bracketDivision, setBracketDivision] = useState<Division>("male");
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterFilter, setRosterFilter] = useState<"all" | Division>("all");

  const loadData = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [loadedPlayers, loadedState] = await Promise.all([getAllPlayers(), getTournamentState()]);
      setPlayers(loadedPlayers); setTournament(loadedState);
      if (loadedState.status === "locked") setSnapshot(await getAdminTournamentSnapshot());
      else setSnapshot({ version: loadedState.version, bracketRevision: 0, roundCount: 0, matches: [], players: [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void loadData(); }, 0); return () => window.clearTimeout(timer); }, [loadData]);
  useEffect(() => subscribeToTournamentState((state) => {
    setTournament(state);
    if (state.status === "locked") void getAdminTournamentSnapshot().then(setSnapshot).catch((cause) => setError(cause instanceof Error ? cause.message : "โหลดสายการแข่งขันไม่สำเร็จ"));
    else setSnapshot({ version: state.version, bracketRevision: 0, roundCount: 0, matches: [], players: [] });
  }), []);
  useEffect(() => {
    const refreshBracket = () => { void getAdminTournamentSnapshot().then(setSnapshot).catch(() => undefined); };
    window.addEventListener("office-smash-bracket", refreshBracket);
    return () => window.removeEventListener("office-smash-bracket", refreshBracket);
  }, []);

  async function mutate(action: () => Promise<unknown>) {
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

  const readyMatchCount = snapshot.matches.filter((match) => match.division === bracketDivision && match.status === "ready").length;
  const ungenderedCount = players.filter((player) => player.gender !== "male" && player.gender !== "female").length;
  const maleCount = players.filter((player) => player.gender === "male").length;
  const femaleCount = players.filter((player) => player.gender === "female").length;
  const drawBlocker = ungenderedCount > 0
    ? `ยังมีผู้เล่นที่ยังไม่ได้ระบุเพศ ${ungenderedCount} คน`
    : maleCount < 2 ? "สายชายต้องมีผู้เล่นอย่างน้อย 2 คน"
    : femaleCount < 2 ? "สายหญิงต้องมีผู้เล่นอย่างน้อย 2 คน"
    : "";

  async function confirmDeletePlayer() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setMutating(true); setDeleteError(""); setError("");
    try {
      const result = await adminDeletePlayer(targetId);
      await loadData();
      setDeleteTarget(null);
      if (result.warning) setError(result.warning);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "ลบผู้เล่นไม่สำเร็จ");
    } finally {
      setMutating(false);
    }
  }

  async function savePlayerProfile(input: { nickname: string; department: string; avatarFile: File | null }) {
    if (!editTarget) return;
    setEditing(true); setEditError(""); setError("");
    try {
      await adminUpdatePlayerProfile(editTarget.id, { nickname: input.nickname, department: input.department });
      if (input.avatarFile) await adminUpdatePlayerAvatar(editTarget.id, input.avatarFile);
      await loadData();
      setEditTarget(null);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "แก้ไขข้อมูลผู้เล่นไม่สำเร็จ");
    } finally {
      setEditing(false);
    }
  }

  function setPlayerGender(player: Player, gender: Division) {
    if (player.gender === gender) return;
    void mutate(() => adminSetPlayerGender(player.id, gender));
  }

  async function saveScore(score1: number, score2: number) {
    if (!scoreTarget) return;
    const updated = await recordMatchScore(scoreTarget.id, score1, score2, scoreTarget.revision);
    setSnapshot(updated);
    setScoreTarget(null);
  }

  async function saveMatchDate(match: BracketMatch, value: string | null) {
    setError("");
    setSnapshot((current) => ({ ...current, matches: current.matches.map((item) => item.id === match.id ? { ...item, scheduledDate: value } : item) }));
    try { setSnapshot(await updateMatchDate(match.id, value)); }
    catch (cause) {
      setSnapshot((current) => ({ ...current, matches: current.matches.map((item) => item.id === match.id ? { ...item, scheduledDate: match.scheduledDate } : item) }));
      setError(cause instanceof Error ? cause.message : "บันทึกวันแข่งขันไม่สำเร็จ");
    }
  }

  return <main className={styles.dashboard}>
    <header className={styles.topbar}><div className={styles.adminBrand}><span><Gamepad2 size={20} /></span><div><b>depa TABLE TENNIS</b><small>CONTROL ROOM · 2026</small></div></div><div className={styles.topActions}><Link href="/brackets" aria-label="หน้าสายการแข่งขันสาธารณะ"><Trophy size={18} /></Link><Link href="/" aria-label="หน้าผู้เล่น"><ArrowLeft size={18} /></Link><button onClick={signOut} aria-label="ออกจากระบบ"><LogOut size={18} /></button></div></header>
    <div className={styles.dashboardBody}>
      <section className={styles.dashboardTitle}><div><span className={styles.kicker}>TOURNAMENT OPERATIONS</span><h1>Match Control</h1></div><div className={`${styles.modeBadge} ${demo ? styles.demo : ""}`}><Wifi size={14} />{onlineModeLabel()}</div></section>
      {demo && <div className={styles.demoNotice}><Sparkles size={17} /><div><b>กำลังใช้ Local Demo Mode</b><span>ข้อมูลทำงานเฉพาะเบราว์เซอร์นี้ ไม่ใช่ระบบออนไลน์</span></div></div>}
      {error && <div className={styles.errorBanner}><CircleAlert size={17} />{error}</div>}
      <section className={styles.metrics}><div><span>REGISTERED</span><b>{players.length}</b><small>PLAYERS</small></div><div><span>ROUND 01</span><b>{Math.ceil(players.length / 2)}</b><small>MATCHES</small></div><div><span>REVEAL</span><b className={tournament.revealOpen ? styles.onlineText : styles.offlineText}>{tournament.revealOpen ? "OPEN" : "LOCK"}</b><small>{tournament.status.toUpperCase()}</small></div></section>

      <section className={styles.controlPanel}><div className={styles.sectionHead}><div><span>EVENT CONTROLS</span><h2>ตั้งค่าสถานะการแข่งขัน</h2></div><Radio size={20} /></div>
        <ControlToggle title="เปิดรับลงทะเบียน" description={tournament.status === "locked" ? "หากเปิดเพิ่ม ต้องสุ่มและล็อกคู่ใหม่เพื่อรวมผู้เล่นล่าสุด" : "ปิดก่อนสุ่มเพื่อไม่ให้รายชื่อเปลี่ยนระหว่างจัดคู่"} checked={tournament.registrationOpen} disabled={mutating} onChange={(checked) => void mutate(() => updateTournamentControls({ registrationOpen: checked, ...(checked ? { revealOpen: false } : {}) }))} />
        <div className={styles.drawVisual}><Shuffle size={31} /><div><b>{snapshot.matches.length ? `สายเต็ม ${snapshot.roundCount} รอบพร้อมแล้ว` : "ยังไม่ได้สุ่มคู่แข่งขัน"}</b><span>{snapshot.matches.length ? "ผู้เล่นกดสุ่มดูคู่ของตัวเองได้ทันที · แอดมินแตะคู่เพื่อกรอกคะแนน" : "เมื่อกดสุ่ม ระบบจะปิดรับสมัครและเปิดให้ผู้เล่นดูคู่ทันที"}</span></div></div>
        <button className={styles.drawButton} onClick={() => void mutate(generateTournamentBracket)} disabled={Boolean(drawBlocker) || mutating || loading}><Shuffle size={19} />{mutating ? "กำลังสุ่มและสร้างสาย..." : snapshot.matches.length ? "สุ่มคู่แข่งขันใหม่และเปิดให้ดู" : "สุ่มคู่แข่งขันและเปิดให้ดู"}</button>
        {drawBlocker && <p className={styles.drawHint}>{drawBlocker} จึงจะจับสายแยกชาย/หญิงได้</p>}
      </section>

      <section className={styles.rosterCard}>
        <div className={styles.sectionHead}><div><span>PLAYER ROSTER</span><h2>ผู้สมัคร</h2></div><Users size={20} /></div>
        <button className={styles.rosterCountBtn} type="button" onClick={() => { setRosterFilter("all"); setRosterOpen(true); }}><b>{players.length}</b><span>คนทั้งหมด</span></button>
        <div className={styles.rosterStats}>
          <div><b>{maleCount}</b><span>ชาย</span></div>
          <div><b>{femaleCount}</b><span>หญิง</span></div>
          <div className={ungenderedCount ? styles.rosterWarn : ""}><b>{ungenderedCount}</b><span>ยังไม่ระบุ</span></div>
        </div>
        <button className={styles.rosterOpenBtn} type="button" onClick={() => { setRosterFilter("all"); setRosterOpen(true); }}><Users size={16} /> ดูและจัดการรายชื่อ</button>
      </section>

      <section className={styles.bracketPanel}><div className={styles.sectionHead}><div><span>LIVE BRACKET · REV {snapshot.bracketRevision}</span><h2>สายการแข่งขันรอบที่ 1 ทั้งหมดและรอบถัดไป</h2></div><Trophy size={20} /></div>{snapshot.matches.length > 0 && <p className={styles.privateNote}><LockKeyhole size={14} /> {readyMatchCount ? `พร้อมกรอกคะแนน ${readyMatchCount} คู่ · เลือกวันแข่งหรือแตะการ์ดเพื่อกรอกคะแนน` : "เลือกวันแข่งได้ทุกคู่ · คู่ที่ชนะบายจะข้ามไปรอบถัดไปเอง"}</p>}{snapshot.matches.length > 0 && <div className={styles.divisionTabs} role="tablist" aria-label="เลือกสายการแข่งขัน">{([["male", "สายชาย"], ["female", "สายหญิง"], ["mixed", "คู่ผสม"]] as Array<[Division, string]>).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={bracketDivision === key} className={bracketDivision === key ? styles.divisionActive : ""} onClick={() => setBracketDivision(key)}>{label}<small>{snapshot.matches.filter((match) => match.division === key && match.round === 1).length} คู่แรก</small></button>)}</div>}<TournamentBracket snapshot={snapshot} admin division={bracketDivision} onSelectMatch={setScoreTarget} onUpdateMatchDate={(match, value) => void saveMatchDate(match, value)} onSelectPlayer={setProfileTarget} /></section>
    </div>
    {recoveryTarget && <AdminRecoverySheet player={recoveryTarget} issued={issuedRecovery} loading={issuingRecovery} onIssue={() => void issueRecoveryCode()} onClose={closeRecoverySheet} />}
    {deleteTarget && <AdminDeleteSheet player={deleteTarget} loading={mutating} error={deleteError} onDelete={() => void confirmDeletePlayer()} onClose={() => { setDeleteTarget(null); setDeleteError(""); }} />}
    {editTarget && <AdminEditPlayerSheet key={editTarget.id} player={editTarget} loading={editing} error={editError} onSave={(input) => void savePlayerProfile(input)} onClose={() => { setEditTarget(null); setEditError(""); }} />}
    {scoreTarget && <ScoreEntrySheet key={`${scoreTarget.id}-${scoreTarget.revision}`} match={scoreTarget} players={snapshot.players} onSave={saveScore} onClose={() => setScoreTarget(null)} />}
    {profileTarget && <PlayerProfileSheet player={profileTarget} snapshot={snapshot} onClose={() => setProfileTarget(null)} />}
    {rosterOpen && <AdminRosterSheet players={players} loading={loading} mutating={mutating} filter={rosterFilter} onFilter={setRosterFilter} onRefresh={() => void loadData()} onSetGender={setPlayerGender} onEdit={(target) => { setEditTarget(target); setEditError(""); }} onIssueRecovery={(target) => { setRecoveryTarget(target); setIssuedRecovery(null); }} onDelete={(target) => { setDeleteTarget(target); setDeleteError(""); }} onClose={() => setRosterOpen(false)} />}
  </main>;
}

function ControlToggle({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`${styles.controlToggle} ${disabled ? styles.controlToggleDisabled : ""}`}><div><b>{title}</b><span>{description}</span></div><input className={styles.toggleInput} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className={`${styles.switch} ${checked ? styles.switchOn : ""}`} aria-hidden="true"><i /></span></label>;
}

function AdminRosterSheet({ players, loading, mutating, filter, onFilter, onRefresh, onSetGender, onEdit, onIssueRecovery, onDelete, onClose }: {
  players: Player[]; loading: boolean; mutating: boolean; filter: "all" | Division;
  onFilter: (value: "all" | Division) => void; onRefresh: () => void;
  onSetGender: (player: Player, gender: Division) => void; onEdit: (player: Player) => void;
  onIssueRecovery: (player: Player) => void; onDelete: (player: Player) => void; onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const shown = players.filter((player) => filter === "all" || player.gender === filter);
  const tabs: Array<{ key: "all" | Division; label: string }> = [
    { key: "all", label: `ทั้งหมด ${players.length}` },
    { key: "male", label: `ชาย ${players.filter((p) => p.gender === "male").length}` },
    { key: "female", label: `หญิง ${players.filter((p) => p.gender === "female").length}` },
  ];
  return <div className={styles.rosterBackdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={styles.rosterSheet} role="dialog" aria-modal="true" aria-label="รายชื่อผู้สมัคร">
      <div className={styles.rosterSheetHead}>
        <div><span className={styles.kicker}>PLAYER ROSTER</span><h2>รายชื่อผู้สมัคร <i>{players.length}</i></h2></div>
        <div className={styles.rosterSheetTools}>
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="โหลดรายชื่อใหม่"><RefreshCw size={17} className={loading ? styles.spinning : ""} /></button>
          <button type="button" onClick={onClose} aria-label="ปิด"><X size={19} /></button>
        </div>
      </div>
      <div className={styles.rosterFilterTabs} role="tablist" aria-label="กรองตามเพศ">
        {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={filter === tab.key} className={filter === tab.key ? styles.rosterFilterOn : ""} onClick={() => onFilter(tab.key)}>{tab.label}</button>)}
      </div>
      {shown.length ? <div className={styles.rosterSheetList}>{shown.map((player, index) => <PlayerRow player={player} index={index} key={player.id} disabled={mutating} onSetGender={(gender) => onSetGender(player, gender)} onEdit={() => onEdit(player)} onIssueRecovery={() => onIssueRecovery(player)} onDelete={() => onDelete(player)} />)}</div>
        : <div className={styles.emptyRoster}><Users size={30} /><b>{players.length ? "ไม่มีผู้เล่นในกลุ่มนี้" : "ยังไม่มีผู้สมัคร"}</b><span>{players.length ? "ลองสลับแท็บดูกลุ่มอื่น" : "รายชื่อจะปรากฏหลังมีผู้เล่นลงทะเบียน"}</span></div>}
    </section>
  </div>;
}

function PlayerRow({ player, index, disabled, onSetGender, onEdit, onIssueRecovery, onDelete }: { player: Player; index: number; disabled: boolean; onSetGender: (gender: Division) => void; onEdit: () => void; onIssueRecovery: () => void; onDelete: () => void }) { return <article className={`${styles.playerRow} ${player.gender ? "" : styles.playerRowUnset}`}><small>{String(index + 1).padStart(2, "0")}</small><div className={styles.rowAvatar}><Image src={player.avatarUrl} alt="" fill unoptimized /></div><div className={styles.playerName}><div><b>{player.nickname}</b>{player.isDemo && <i>DEMO</i>}</div><span>{player.id} · {player.department}</span></div><div className={styles.genderPick} role="group" aria-label={`เพศของ ${player.nickname}`}><button type="button" className={player.gender === "male" ? styles.genderOn : ""} disabled={disabled} onClick={() => onSetGender("male")} aria-pressed={player.gender === "male"}>ชาย</button><button type="button" className={player.gender === "female" ? styles.genderOnF : ""} disabled={disabled} onClick={() => onSetGender("female")} aria-pressed={player.gender === "female"}>หญิง</button></div><div className={styles.rowActions}><button className={styles.editAction} type="button" onClick={onEdit} aria-label={`แก้ไขข้อมูล ${player.nickname}`}><Pencil size={16} /><span>แก้ไข</span></button><button className={styles.recoveryAction} type="button" onClick={onIssueRecovery} aria-label={`ออกรหัสกู้คืนใหม่ให้ ${player.nickname}`}><KeyRound size={16} /><span>รหัส</span></button><button className={styles.deleteAction} type="button" onClick={onDelete} aria-label={`ลบ ${player.nickname}`}><Trash2 size={17} /></button></div></article>; }

function AdminEditPlayerSheet({ player, loading, error, onSave, onClose }: { player: Player; loading: boolean; error: string; onSave: (input: { nickname: string; department: string; avatarFile: File | null }) => void; onClose: () => void }) {
  const [nickname, setNickname] = useState(player.nickname);
  const [department, setDepartment] = useState(player.department);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(player.avatarUrl);
  const [avatarError, setAvatarError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  function pickAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAcceptedAvatar(file)) { setAvatarError("รองรับเฉพาะไฟล์รูปภาพเท่านั้น"); return; }
    if (file.size > 10 * 1024 * 1024) { setAvatarError("รูปต้องมีขนาดไม่เกิน 10 MB"); return; }
    setAvatarError("");
    setAvatarFile(file);
    setPreview((current) => { if (current.startsWith("blob:")) URL.revokeObjectURL(current); return URL.createObjectURL(file); });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ nickname, department, avatarFile });
  }
  return <div className={styles.sheetBackdrop}><motion.section className={styles.recoverySheet} role="dialog" aria-modal="true" aria-labelledby="admin-edit-title" initial={{ y: "100%" }} animate={{ y: 0 }}><button className={styles.sheetClose} type="button" onClick={onClose} disabled={loading} aria-label="ปิด"><X size={20} /></button><div className={styles.editMark}><Pencil size={23} /></div><span className={styles.kicker}>EDIT PLAYER</span><h2 id="admin-edit-title">แก้ไขข้อมูล {player.id}</h2><form className={styles.editForm} onSubmit={submit}><div className={styles.editAvatar}><div className={styles.editAvatarImg}><Image src={preview} alt={`รูปของ ${player.nickname}`} fill sizes="88px" unoptimized /></div><button type="button" className={styles.editAvatarBtn} onClick={() => fileRef.current?.click()} disabled={loading}><ImagePlus size={16} /> {avatarFile ? "เลือกรูปใหม่แล้ว · เปลี่ยนอีกครั้ง" : "เปลี่ยนรูปโปรไฟล์"}</button><input ref={fileRef} type="file" accept="image/*,.heic,.heif" onChange={pickAvatar} hidden /></div>{avatarError && <div className={styles.authError}><CircleAlert size={16} />{avatarError}</div>}<label><span>ชื่อเล่น</span><input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={40} required autoFocus /></label><label><span>ฝ่าย/ส่วนงาน</span><input value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={80} required /></label>{error && <div className={styles.authError}><CircleAlert size={16} />{error}</div>}<button className={styles.issueButton} type="submit" disabled={loading}><Pencil size={18} />{loading ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button><button className={styles.cancelButton} type="button" onClick={onClose} disabled={loading}>ยกเลิก</button></form></motion.section></div>;
}

function AdminDeleteSheet({ player, loading, error, onDelete, onClose }: { player: Player; loading: boolean; error: string; onDelete: () => void; onClose: () => void }) {
  return <div className={styles.sheetBackdrop}><motion.section className={styles.recoverySheet} role="dialog" aria-modal="true" aria-labelledby="admin-delete-title" initial={{ y: "100%" }} animate={{ y: 0 }}><button className={styles.sheetClose} type="button" onClick={onClose} disabled={loading} aria-label="ปิด"><X size={20} /></button><div className={styles.deleteMark}><Trash2 size={24} /></div><span className={styles.kicker}>REMOVE PLAYER</span><h2 id="admin-delete-title">ลบ {player.nickname} ออกจากการแข่งขัน?</h2><p className={styles.recoveryWarning}>การลบจะยกเลิกผลจับคู่เดิมและปิดการเปิดเผยคู่ทันที หลังแก้รายชื่อแล้วต้องสุ่มและล็อกคู่ใหม่</p>{error && <div className={styles.authError}><CircleAlert size={16} />{error}</div>}<button className={styles.deleteConfirmButton} type="button" onClick={onDelete} disabled={loading}><Trash2 size={18} />{loading ? "กำลังลบ..." : "ยืนยันลบผู้เล่น"}</button><button className={styles.cancelButton} type="button" onClick={onClose} disabled={loading}>ยกเลิก</button></motion.section></div>;
}

function AdminRecoverySheet({ player, issued, loading, onIssue, onClose }: { player: Player; issued: { playerId: string; recoveryCode: string } | null; loading: boolean; onIssue: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() { if (!issued) return; try { await navigator.clipboard.writeText(issued.recoveryCode); setCopied(true); } catch { setCopied(false); } }
  return <div className={styles.sheetBackdrop}><motion.section className={styles.recoverySheet} role="dialog" aria-modal="true" aria-labelledby="admin-recovery-title" initial={{ y: "100%" }} animate={{ y: 0 }}><button className={styles.sheetClose} type="button" onClick={onClose} aria-label="ปิด"><X size={20} /></button><div className={styles.recoveryMark}><KeyRound size={24} /></div><span className={styles.kicker}>PLAYER RECOVERY</span><h2 id="admin-recovery-title">{issued ? "รหัสใหม่พร้อมส่งให้ผู้เล่น" : `ออกรหัสใหม่ให้ ${player.nickname}`}</h2>{issued ? <><div className={styles.issuedCode}><span>{issued.playerId}</span><strong>{issued.recoveryCode}</strong></div><p className={styles.recoveryWarning}>รหัสนี้แสดงเพียงครั้งเดียว ส่งให้ผู้เล่นผ่านช่องทางส่วนตัว และอย่าแชร์ในกลุ่มสาธารณะ</p><button className={styles.copyButton} type="button" onClick={copyCode}><Copy size={18} />{copied ? "คัดลอกแล้ว" : "คัดลอกรหัส"}</button></> : <><p className={styles.recoveryWarning}>การยืนยันจะทำให้รหัสเดิมใช้ไม่ได้ทันที ใช้เมื่อผู้เล่นทำรหัสหายหรือเป็นบัญชีเดิมที่ยังไม่มีรหัสเท่านั้น</p><button className={styles.issueButton} type="button" onClick={onIssue} disabled={loading}><KeyRound size={18} />{loading ? "กำลังออกรหัส..." : "ยืนยันและหมุนรหัสใหม่"}</button></>}<button className={styles.cancelButton} type="button" onClick={onClose}>{issued ? "ปิดหน้าต่าง" : "ยกเลิก"}</button></motion.section></div>;
}
