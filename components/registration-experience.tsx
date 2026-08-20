"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ImagePlus,
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
import {
  getTournamentState,
  initialTournamentState,
  PLAYER_STORAGE_KEY,
  registerPlayerOnline,
  subscribeToTournamentState,
} from "@/lib/tournament-store";
import type { Player, TournamentState } from "@/lib/types";

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
  const [dismissedDraw, setDismissedDraw] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const restorePlayer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(PLAYER_STORAGE_KEY);
      if (!saved) return;
      try {
        const storedPlayer = JSON.parse(saved) as Player;
        setPlayer(storedPlayer);
        setView("lobby");
      } catch {
        window.localStorage.removeItem(PLAYER_STORAGE_KEY);
      }
    }, 0);

    return () => window.clearTimeout(restorePlayer);
  }, []);

  useEffect(() => {
    void getTournamentState().then(setTournament);
    return subscribeToTournamentState(setTournament);
  }, []);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const imageExtension = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (!file.type.startsWith("image/") && !imageExtension) {
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
      const savedPlayer = await registerPlayerOnline(newPlayer, avatarFile);
      setPlayer(savedPlayer);
      setConfirmOpen(false);
      setView("lobby");
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "สมัครแข่งขันไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  }

  function editRegistration() {
    if (player) {
      setForm({ nickname: player.nickname, department: player.department });
      setAvatarUrl(player.avatarUrl);
    }
    setView("registration");
  }

  return (
    <main className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="court-line court-line-left" aria-hidden="true" />
      <div className="court-line court-line-right" aria-hidden="true" />

      <header className="site-header">
        <button className="brand-lockup" onClick={() => setView("registration")} aria-label="ไปหน้าลงทะเบียน">
          <span className="brand-mark"><span className="brand-paddle" /></span>
          <span><b>depa TABLE TENNIS</b><strong>TOURNAMENT 2026</strong></span>
        </button>
        <div className="live-pill"><span /> REGISTRATION OPEN</div>
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

            <section className="registration-card" aria-labelledby="form-title">
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
              </form>
            </section>
          </motion.div>
        ) : player ? (
          <Lobby key="lobby" player={player} tournament={tournament} onEdit={editRegistration} reduceMotion={Boolean(reduceMotion)} />
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
        {tournament.status === "drawing" && tournament.version > dismissedDraw && (
          <MatchmakingRoulette state={tournament} onFinish={() => setDismissedDraw(tournament.version)} />
        )}
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

function Lobby({ player, tournament, onEdit, reduceMotion }: { player: Player; tournament: TournamentState; onEdit: () => void; reduceMotion: boolean }) {
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
        <p>ใบสมัครถูกล็อกแล้ว เตรียมตัวให้พร้อม<br />ระบบจะแจ้งเตือนเมื่อเริ่มจับคู่</p>
      </section>

      <section className="player-ticket" aria-label="การ์ดผู้เล่น">
        <div className="ticket-topline"><span>OFFICIAL PLAYER PASS</span><b>#OS-{player.id.slice(0, 4).toUpperCase()}</b></div>
        <div className="player-portrait">
          <Image src={player.avatarUrl} alt={`รูปโปรไฟล์ของ ${player.nickname}`} fill unoptimized />
          <div className="portrait-scanline" />
          <span className="seed-badge">ROOKIE</span>
        </div>
        <div className="player-info">
          <span className="player-status"><i /> WAITING IN LOBBY</span>
          <h2>{player.nickname}</h2>
          <p>{player.department}</p>
          <div className="player-meta">
            <div><span>SEED</span><b>—</b></div>
            <div><span>WINS</span><b>0</b></div>
            <div><span>STATUS</span><b>READY</b></div>
          </div>
        </div>
        <div className="ticket-cut ticket-cut-left" /><div className="ticket-cut ticket-cut-right" />
      </section>

      <div className="lobby-message"><Sparkles size={19} /><div><b>{tournament.status === "ready" ? "จับคู่แข่งขันสำเร็จแล้ว" : "อยู่ใน Lobby แล้ว"}</b><span>{tournament.status === "ready" ? "เตรียมพบกับคู่แข่งของคุณในสายการแข่งขัน" : "รอแอดมินเริ่ม Matchmaking Roulette"}</span></div></div>
      <button className="secondary-button" onClick={onEdit}><ChevronLeft size={18} /> แก้ไขข้อมูลผู้เล่น</button>
      <div className="next-up"><span>NEXT UP</span><i /><b><Trophy size={16} /> MATCHMAKING ROULETTE</b></div>
    </motion.div>
  );
}

function CircleAlertIcon() {
  return <span aria-hidden="true">!</span>;
}
