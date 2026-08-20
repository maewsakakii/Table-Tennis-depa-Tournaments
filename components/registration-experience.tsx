"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Trophy,
  Upload,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { MatchmakingRoulette } from "@/components/matchmaking-roulette";
import { PlayerProfileSheet } from "@/components/player-profile-sheet";
import { TournamentBracket } from "@/components/tournament-bracket";
import { deriveMatchHistory } from "@/lib/bracket";
import { isAcceptedAvatar } from "@/lib/local-avatar";
import {
  getTournamentState,
  getPlayerTournamentSnapshot,
  initialTournamentState,
  readPlayerIdentity,
  restoreSavedPlayerSession,
  registerPlayerWithIdentity,
  restorePlayerWithRecoveryCode,
  revealMyOpponent,
  subscribeToTournamentState,
  toPublicPlayer,
} from "@/lib/tournament-store";
import type { Player, PlayerReveal, PlayerTournamentSnapshot, PublicPlayer, TournamentState } from "@/lib/types";

type FormState = Pick<Player, "nickname" | "department">;
type Errors = Partial<Record<keyof FormState | "avatar", string>>;

const emptyForm: FormState = { nickname: "", department: "" };

export function RegistrationExperience() {
  const [view, setView] = useState<"registration" | "lobby">("registration");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [tournament, setTournament] = useState<TournamentState>(initialTournamentState);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [restoreCode, setRestoreCode] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [reveal, setReveal] = useState<PlayerReveal | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState("");
  const [backendError, setBackendError] = useState("");
  const [playerSnapshot, setPlayerSnapshot] = useState<PlayerTournamentSnapshot | null>(null);
  const [bracketOpen, setBracketOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<PublicPlayer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const restorePlayer = window.setTimeout(() => {
      void restoreSavedPlayerSession().then((storedPlayer) => {
        if (!storedPlayer) return;
        setPlayer(storedPlayer);
        setRecoveryCode(readPlayerIdentity()?.recoveryCode ?? "");
        setView("lobby");
      }).catch((cause) => {
        setBackendError(cause instanceof Error ? cause.message : "ตรวจสอบข้อมูลผู้เล่นไม่สำเร็จ");
      });
    }, 0);

    return () => window.clearTimeout(restorePlayer);
  }, []);

  useEffect(() => {
    if (!player || tournament.status !== "locked") return;
    void getPlayerTournamentSnapshot().then(setPlayerSnapshot).catch((cause) => setLobbyError(cause instanceof Error ? cause.message : "โหลดสายการแข่งขันไม่สำเร็จ"));
  }, [player, tournament.status, tournament.version, tournament.revealOpen]);

  useEffect(() => {
    if (!player) return;
    const refreshBracket = () => { void getPlayerTournamentSnapshot().then(setPlayerSnapshot).catch(() => undefined); };
    window.addEventListener("office-smash-bracket", refreshBracket);
    return () => window.removeEventListener("office-smash-bracket", refreshBracket);
  }, [player]);

  useEffect(() => {
    void getTournamentState().then(setTournament).catch((cause) => setBackendError(cause instanceof Error ? cause.message : "ระบบออนไลน์ยังไม่พร้อมใช้งาน"));
    return subscribeToTournamentState((state) => {
      setTournament(state);
      if (state.status !== "locked") {
        setPlayerSnapshot(null);
      } else if (player) {
        void getPlayerTournamentSnapshot().then(setPlayerSnapshot).catch(() => undefined);
      }
    });
  }, [player]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isAcceptedAvatar(file)) {
      setErrors((current) => ({ ...current, avatar: "รองรับเฉพาะไฟล์รูปภาพเท่านั้น" }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors((current) => ({ ...current, avatar: "รูปต้องมีขนาดไม่เกิน 10 MB" }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(String(reader.result));
      setAvatarFile(file);
      setErrors((current) => ({ ...current, avatar: undefined }));
    };
    reader.onerror = () => setErrors((current) => ({ ...current, avatar: "อ่านไฟล์รูปไม่สำเร็จ กรุณาเลือกรูปอื่น" }));
    reader.readAsDataURL(file);
  }

  function validate() {
    const nextErrors: Errors = {};
    if (form.nickname.trim().length < 2) nextErrors.nickname = "กรอกชื่อเล่นอย่างน้อย 2 ตัวอักษร";
    if (form.department.trim().length < 2) nextErrors.department = "กรอกฝ่ายหรือส่วนงานอย่างน้อย 2 ตัวอักษร";
    if (!avatarUrl) nextErrors.avatar = "อัปโหลดรูปหน้าจริงก่อนสมัคร";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (validate()) setConfirmOpen(true);
  }

  async function confirmRegistration() {
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const newPlayer: Player = {
        id: crypto.randomUUID(),
        nickname: form.nickname.trim(),
        department: form.department.trim(),
        avatarUrl,
        registeredAt: new Date().toISOString(),
        status: "waiting",
      };
      const registration = await registerPlayerWithIdentity(newPlayer, avatarFile);
      setPlayer(registration.player);
      setRecoveryCode(registration.recoveryCode);
      setConfirmOpen(false);
      setView("lobby");
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "สมัครแข่งขันไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function restoreIdentity(event: FormEvent) {
    event.preventDefault();
    setRestoring(true);
    setSubmitError("");
    try {
      const restored = await restorePlayerWithRecoveryCode(restoreCode);
      setPlayer(restored);
      setRecoveryCode(readPlayerIdentity()?.recoveryCode ?? restoreCode.trim().toUpperCase());
      setView("lobby");
      setRestoreOpen(false);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "กู้คืนผู้เล่นไม่สำเร็จ");
    } finally { setRestoring(false); }
  }

  async function revealOpponent() {
    setRevealLoading(true);
    setLobbyError("");
    try {
      const [revealed, snapshot] = await Promise.all([revealMyOpponent(), getPlayerTournamentSnapshot()]);
      setPlayerSnapshot(snapshot);
      setReveal(revealed);
    }
    catch (cause) { setLobbyError(cause instanceof Error ? cause.message : "เปิดผลจับคู่ไม่สำเร็จ"); }
    finally { setRevealLoading(false); }
  }

  return (
    <main className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="court-line court-line-left" aria-hidden="true" />
      <div className="court-line court-line-right" aria-hidden="true" />

      <header className="site-header">
        <button className="brand-lockup" type="button" onClick={() => setView(player ? "lobby" : "registration")} aria-label={player ? "กลับหน้า Lobby ของฉัน" : "ไปหน้าลงทะเบียน"}>
          <span className="brand-mark"><span className="brand-paddle" /></span>
          <span><b>depa TABLE TENNIS</b><strong>TOURNAMENT 2026</strong></span>
        </button>
        <div className={`live-pill ${!tournament.registrationOpen ? "registration-closed-pill" : ""}`}><span /> {tournament.registrationOpen ? "REGISTRATION OPEN" : "REGISTRATION CLOSED"}</div>
      </header>

      <AnimatePresence mode="wait">
        {view === "registration" ? (
          <motion.div
            key="registration"
            className="page-wrap"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
          >
            <section className="hype-panel" aria-labelledby="campaign-title">
              <div className="season-tag"><Zap size={14} fill="currentColor" /> depa TABLE TENNIS · 2026</div>
              <h1 id="campaign-title">
                ถึงเวลาพิสูจน์<br />ว่าใครคือ <em>ตัวตึง</em>
              </h1>
              <p>depa TABLE TENNIS TOURNAMENT 2026<br className="mobile-break" /> แข่งขันระบบ Knockout หลังเลิกงาน</p>
              <div className="campaign-stats" aria-label="รายละเอียดการแข่งขัน">
                <div><span>FORMAT</span><b>1 VS 1</b></div>
                <div><span>PRIZE POOL</span><b className="prize-value">COMING SOON</b></div>
                <div><span>MODE</span><b>KNOCKOUT</b></div>
              </div>
            </section>

            {backendError ? (
              <SetupUnavailable message={backendError} />
            ) : !tournament.registrationOpen ? (
              <RegistrationClosed onRestore={() => setRestoreOpen(true)} />
            ) : <section className="registration-card" aria-labelledby="form-title">
              <div className="card-index" aria-hidden="true">01</div>
              <div className="form-heading">
                <span className="eyebrow">PLAYER ENTRY</span>
                <h2 id="form-title">ลงทะเบียนเข้าสู่สนาม</h2>
                <p>กรอกข้อมูลให้ครบ แล้วเตรียมตัวรอจับคู่ได้เลย</p>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="field-grid">
                  <Field label="ชื่อเล่น" error={errors.nickname} icon={<UserRound size={18} />} className="nickname-field">
                    <input
                      value={form.nickname}
                      onChange={(event) => updateField("nickname", event.target.value)}
                      placeholder="กรอกชื่อเล่นของคุณ"
                      autoComplete="nickname"
                      aria-invalid={Boolean(errors.nickname)}
                    />
                  </Field>

                  <Field label="ฝ่าย / ส่วนงาน" error={errors.department} icon={<UsersRound size={18} />}>
                    <input
                      value={form.department}
                      onChange={(event) => updateField("department", event.target.value)}
                      placeholder="พิมพ์ฝ่ายหรือส่วนงานของคุณ"
                      autoComplete="organization-title"
                      aria-invalid={Boolean(errors.department)}
                    />
                  </Field>
                </div>

                <div className="upload-section">
                  <div className="upload-copy">
                    <div className="label-row"><ImagePlus size={18} /><span>รูปหน้าผู้เล่น</span><small>จำเป็น</small></div>
                    <p>ใช้รูปหน้าจริง เห็นใบหน้าชัดเจน เพื่อใช้บนการ์ดและสายแข่งขัน</p>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*,.heic,.heif" onChange={handleAvatar} hidden />
                  <button
                    className={`upload-dropzone ${avatarUrl ? "has-image" : ""} ${errors.avatar ? "has-error" : ""}`}
                    type="button"
                    onClick={() => {
                      if (fileRef.current) {
                        fileRef.current.value = "";
                        fileRef.current.click();
                      }
                    }}
                  >
                    {avatarUrl ? (
                      <>
                        <Image src={avatarUrl} alt="ตัวอย่างรูปโปรไฟล์" fill unoptimized className="avatar-preview" />
                        <span className="replace-photo"><Upload size={15} /> เปลี่ยนรูป</span>
                        <span className="photo-check"><Check size={15} /></span>
                      </>
                    ) : (
                      <>
                        <span className="upload-icon"><Upload size={24} /></span>
                        <b>แตะเพื่ออัปโหลดรูป</b>
                        <span>รูปจากกล้องหรือคลังภาพ · สูงสุด 10 MB</span>
                      </>
                    )}
                  </button>
                  {errors.avatar && <p className="field-error upload-error">{errors.avatar}</p>}
                </div>

                <div className="privacy-note"><ShieldCheck size={18} /><span>ข้อมูลของคุณใช้สำหรับจัดการแข่งขันและแสดงผลในสายแข่งขันเท่านั้น</span></div>

                <motion.button className="primary-button" type="submit" whileTap={{ scale: 0.97 }}>
                  <span>ล็อกอินเข้าสู่สนาม</span><ArrowRight size={20} />
                </motion.button>
                <button className="recovery-entry-button" type="button" onClick={() => setRestoreOpen(true)}><KeyRound size={17} /> มีรหัสกู้คืนผู้เล่นอยู่แล้ว</button>
              </form>
            </section>}
          </motion.div>
        ) : player ? (
          <Lobby key="lobby" player={player} tournament={tournament} recoveryCode={recoveryCode} revealLoading={revealLoading} bracketReady={Boolean(playerSnapshot?.matches.length)} wins={playerSnapshot ? deriveMatchHistory(playerSnapshot, player.id).length : 0} passStatus={playerPassStatus(playerSnapshot, player.id)} error={lobbyError} onReveal={revealOpponent} onOpenBracket={() => setBracketOpen(true)} reduceMotion={Boolean(reduceMotion)} />
        ) : null}
      </AnimatePresence>

      <footer><span>depa TABLE TENNIS 2026</span><i /> <span>PLAY FAIR · HAVE FUN</span></footer>

      <AnimatePresence>
        {confirmOpen && (
          <ConfirmationSheet
            avatarUrl={avatarUrl}
            nickname={form.nickname}
            onClose={() => setConfirmOpen(false)}
            onConfirm={confirmRegistration}
            isSubmitting={isSubmitting}
            error={submitError}
            reduceMotion={Boolean(reduceMotion)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {restoreOpen && <RecoverySheet value={restoreCode} onChange={setRestoreCode} onClose={() => { setRestoreOpen(false); setSubmitError(""); }} onSubmit={restoreIdentity} loading={restoring} error={submitError} />}
        {reveal && player && <MatchmakingRoulette player={toPublicPlayer(player)} reveal={reveal} candidates={playerSnapshot?.players ?? [toPublicPlayer(player), ...(reveal.opponent ? [reveal.opponent] : [])]} onSelectPlayer={(target) => { setReveal(null); setProfileTarget(target); }} onFinish={() => setReveal(null)} />}
        {bracketOpen && playerSnapshot && <PlayerBracketView snapshot={playerSnapshot} onClose={() => setBracketOpen(false)} onSelectPlayer={setProfileTarget} />}
        {profileTarget && playerSnapshot && <PlayerProfileSheet player={profileTarget} snapshot={playerSnapshot} onClose={() => setProfileTarget(null)} />}
      </AnimatePresence>
    </main>
  );
}

function Field({
  label,
  error,
  icon,
  children,
  className = "",
}: {
  label: string;
  error?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className} ${error ? "field-invalid" : ""}`}>
      <span className="field-label">{icon}{label}</span>
      <span className="input-wrap">{children}</span>
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function ConfirmationSheet({
  avatarUrl,
  nickname,
  onClose,
  onConfirm,
  isSubmitting,
  error,
  reduceMotion,
}: {
  avatarUrl: string;
  nickname: string;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  error: string;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      className="sheet-backdrop"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => event.target === event.currentTarget && !isSubmitting && onClose()}
    >
      <motion.section
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        initial={reduceMotion ? false : { y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
      >
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} disabled={isSubmitting} aria-label="ปิด"><X size={20} /></button>
        <div className="verify-avatar">
          <Image src={avatarUrl} alt={`รูปโปรไฟล์ของ ${nickname}`} fill unoptimized />
          <span><ShieldCheck size={18} /></span>
        </div>
        <span className="warning-kicker">ยืนยันตัวตนผู้เข้าแข่งขัน</span>
        <h2 id="confirm-title">นี่คือรูปหน้าจริง<br />ของคุณใช่ไหม?</h2>
        <div className="rule-alert">
          <strong>กติกาสำคัญ</strong>
          <p>กรุณาใช้รูปหน้าจริงของคุณ หากตรวจสอบพบว่าไม่ใช่รูปตัวจริง ทางผู้จัดขอมอบเงินรางวัลให้ลำดับถัดไปแทน</p>
        </div>
        {error && <div className="sheet-error"><CircleAlertIcon />{error}</div>}
        <button className="confirm-button" onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? <span className="button-loader" /> : <Check size={20} />}
          {isSubmitting ? "กำลังส่งใบสมัคร..." : "ยืนยันและสมัครแข่งขัน"}
        </button>
        <button className="text-button" onClick={onClose} disabled={isSubmitting}>กลับไปเปลี่ยนรูป</button>
      </motion.section>
    </motion.div>
  );
}

function Lobby({ player, tournament, recoveryCode, revealLoading, bracketReady, wins, passStatus, error, onReveal, onOpenBracket, reduceMotion }: { player: Player; tournament: TournamentState; recoveryCode: string; revealLoading: boolean; bracketReady: boolean; wins: number; passStatus: string; error: string; onReveal: () => void; onOpenBracket: () => void; reduceMotion: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }

  return (
    <motion.div
      className="lobby-wrap"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
    >
      <section className="lobby-intro">
        <motion.div
          className="success-orbit"
          initial={reduceMotion ? false : { rotate: -80, scale: 0 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", delay: 0.1 }}
        >
          <Check size={30} strokeWidth={3} />
        </motion.div>
        <span className="eyebrow">REGISTRATION COMPLETE</span>
        <h1>เข้าร่วมสนาม<br /><em>สำเร็จ!</em></h1>
        <p>เครื่องนี้จำโปรไฟล์ของคุณไว้แล้ว<br />กลับมาเมื่อไรก็เข้าสู่ Lobby เดิมอัตโนมัติ</p>
      </section>

      <section className="player-ticket" aria-label="การ์ดผู้เล่น">
        <div className="ticket-topline"><span>OFFICIAL PLAYER PASS</span><b>{player.id}</b></div>
        <div className="player-portrait">
          <Image src={player.avatarUrl} alt={`รูปโปรไฟล์ของ ${player.nickname}`} fill unoptimized />
          <div className="portrait-scanline" />
          <span className="seed-badge">ROOKIE</span>
        </div>
        <div className="player-info">
          <span className="player-status"><i /> {passStatus}</span>
          <h2>{player.nickname}</h2>
          <p>{player.department}</p>
          <div className="player-meta">
            <div><span>PLAYER ID</span><b>{player.id}</b></div>
            <div><span>WINS</span><b>{wins}</b></div>
            <div><span>STATUS</span><b>{passStatus}</b></div>
          </div>
        </div>
        <div className="ticket-cut ticket-cut-left" /><div className="ticket-cut ticket-cut-right" />
      </section>

      {recoveryCode && <section className="recovery-card" aria-label="รหัสกู้คืนผู้เล่น"><div><span>RECOVERY CODE · เก็บเป็นความลับ</span><strong>{recoveryCode}</strong></div><button type="button" onClick={copyCode} aria-label="คัดลอกรหัสกู้คืน"><Copy size={17} /> {copied ? "คัดลอกแล้ว" : "คัดลอก"}</button><p>บันทึกหรือแคปหน้าจอรหัสนี้ไว้ หากเปลี่ยนเครื่องหรือล้างข้อมูลเบราว์เซอร์ คุณต้องใช้รหัสนี้เพื่อกลับเข้าชื่อเดิม</p></section>}

      <div className="lobby-message"><Sparkles size={19} /><div><b>{tournament.revealOpen ? "จับคู่แข่งขันเรียบร้อยแล้ว!" : tournament.status === "locked" ? "ปิดรับสมัครชั่วคราว" : "อยู่ใน Lobby แล้ว"}</b><span>{tournament.revealOpen ? "แอดมินสุ่มคู่แล้ว กดเพื่อดูคู่แข่งของคุณ" : tournament.status === "locked" ? "รอแอดมินกดสุ่มคู่แข่งขัน" : "รอแอดมินสุ่มคู่แข่งขัน"}</span></div></div>
      {error && <div className="lobby-error"><CircleAlertIcon />{error}</div>}
      {tournament.revealOpen ? <motion.button className="primary-button reveal-button" type="button" onClick={onReveal} disabled={revealLoading} whileTap={{ scale: .97 }}><Zap size={20} />{revealLoading ? "กำลังโหลดคู่ของคุณ..." : "สุ่มดูคู่แข่งของฉัน"}</motion.button> : <button className="secondary-button" type="button" disabled><LockKeyhole size={18} /> รอแอดมินสุ่มคู่</button>}
      <button className="secondary-button bracket-cta" type="button" onClick={onOpenBracket} disabled={!bracketReady}><Trophy size={18} />{bracketReady ? "ดูสายการแข่งขัน" : "สายการแข่งขันยังไม่พร้อม"}</button>
      <div className="next-up"><span>NEXT UP</span><i /><b><Trophy size={16} /> MATCHMAKING ROULETTE</b></div>
    </motion.div>
  );
}

function playerPassStatus(snapshot: PlayerTournamentSnapshot | null, playerId: string) {
  if (!snapshot?.matches.length) return "LOBBY";
  const final = snapshot.matches.find((match) => match.round === snapshot.roundCount);
  if (final?.status === "completed" && final.winnerId === playerId) return "CHAMPION";
  if (snapshot.matches.some((match) => match.status === "completed" && match.winnerId !== playerId && (match.player1Id === playerId || match.player2Id === playerId))) return "ELIMINATED";
  if (snapshot.matches.some((match) => (match.player1Id === playerId || match.player2Id === playerId) && (match.status === "ready" || match.status === "bye"))) return "READY";
  return "WAITING";
}

function PlayerBracketView({ snapshot, onClose, onSelectPlayer }: { snapshot: PlayerTournamentSnapshot; onClose: () => void; onSelectPlayer: (player: PublicPlayer) => void }) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <motion.section className="player-bracket-screen" role="dialog" aria-modal="true" aria-labelledby="player-bracket-title" initial={reduceMotion ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}><header><button type="button" onClick={onClose}><ArrowLeft size={19} /> Lobby</button><div><span>LIVE KNOCKOUT</span><h2 id="player-bracket-title">สายการแข่งขัน</h2></div><b>REV {snapshot.bracketRevision}</b></header><main><div className="player-path-note"><Sparkles size={17} /><div><b>เส้นทางของคุณไฮไลต์สีเขียว</b><span>ปัดซ้าย–ขวา หรือใช้ปุ่มเพื่อดูแต่ละรอบ</span></div></div><TournamentBracket snapshot={snapshot} currentPlayerId={snapshot.playerId} onSelectPlayer={onSelectPlayer} /></main></motion.section>;
}

function RegistrationClosed({ onRestore }: { onRestore: () => void }) {
  return <section className="registration-card closed-card" aria-labelledby="closed-title"><div className="closed-icon"><LockKeyhole size={27} /></div><span className="eyebrow">REGISTRATION CLOSED</span><h2 id="closed-title">ปิดรับสมัครแล้ว</h2><p>การแข่งขันกำลังเข้าสู่ช่วงจับคู่ ผู้สมัครเดิมยังกลับเข้า Lobby ได้ด้วยรหัสกู้คืน</p><button className="primary-button" type="button" onClick={onRestore}><KeyRound size={18} /> ใช้รหัสกู้คืนผู้เล่น</button></section>;
}

function SetupUnavailable({ message }: { message: string }) {
  return <section className="registration-card closed-card" role="alert"><div className="closed-icon"><CircleAlertIcon /></div><span className="eyebrow">SETUP REQUIRED</span><h2>ระบบออนไลน์ยังไม่พร้อม</h2><p>{message}</p><small>กรุณาแจ้งผู้จัดการแข่งขันให้ตรวจสอบ Supabase และ Environment Variables</small></section>;
}

function RecoverySheet({ value, onChange, onClose, onSubmit, loading, error }: { value: string; onChange: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent) => void; loading: boolean; error: string }) {
  return <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="bottom-sheet recovery-sheet" role="dialog" aria-modal="true" aria-labelledby="recovery-title" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}><div className="sheet-handle" /><button className="sheet-close" onClick={onClose} aria-label="ปิด"><X size={20} /></button><div className="closed-icon"><KeyRound size={25} /></div><span className="warning-kicker">RETURNING PLAYER</span><h2 id="recovery-title">กลับเข้าชื่อเดิม</h2><p>กรอกรหัสที่ได้รับหลังสมัคร เพื่อกู้คืน Player Pass บนเครื่องนี้</p><form onSubmit={onSubmit}><label className="recovery-input-label"><span>รหัสกู้คืนผู้เล่น</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="DT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" required /></label>{error && <div className="sheet-error"><CircleAlertIcon />{error}</div>}<button className="confirm-button" disabled={loading}>{loading ? <span className="button-loader" /> : <KeyRound size={18} />}{loading ? "กำลังกู้คืน..." : "กลับเข้า Lobby"}</button></form></motion.section></motion.div>;
}

function CircleAlertIcon() {
  return <span aria-hidden="true">!</span>;
}
