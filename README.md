# depa TABLE TENNIS TOURNAMENT 2026

เว็บทัวร์นาเมนต์ปิงปองสำหรับออฟฟิศ ออกแบบ Mobile-First พร้อมระบบลงทะเบียน, Lobby, Admin Control Room และ Matchmaking Roulette แบบ Realtime

## Routes

- `/` — ลงทะเบียนผู้เล่น, Player Pass, Lobby และหน้าจอ Roulette
- `/admin` — ล็อกอินแอดมิน, ดูรายชื่อ และควบคุมการจับคู่

## Local development

```bash
npm install
npm run dev
```

เปิด `http://localhost:3000` และ `http://localhost:3000/admin`

Local Demo จะไม่เปิดเองอัตโนมัติ เพื่อไม่ให้ production เผลอทำงานคนละเครื่อง หากต้องการทดสอบแบบ localStorage ให้เพิ่ม `NEXT_PUBLIC_ENABLE_LOCAL_DEMO=true` ใน `.env.local` (ใช้เฉพาะ development)

## Supabase setup

1. สร้างโปรเจกต์ใหม่ใน Supabase
2. เปิด **SQL Editor** แล้วรันไฟล์ migration ตามลำดับ `001`, `002`, `003` (ไฟล์ทั้งหมดรันซ้ำได้)
3. ไปที่ **Authentication → Users → Add user → Create new user** แล้วกำหนดอีเมลและรหัสผ่านสำหรับผู้จัด
4. เปิด SQL Editor แล้วเพิ่มอีเมลเดียวกันเป็นผู้ดูแล:

```sql
insert into public.admin_emails (email)
values ('your-email@example.com');
```

5. คัดลอก `.env.example` เป็น `.env.local` แล้วกรอกค่า:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Migration จะสร้าง:

- ตาราง `players` สำหรับข้อมูลผู้สมัคร
- ตาราง `admin_users` สำหรับสิทธิ์ผู้จัด
- ตาราง `admin_emails` สำหรับรายชื่ออีเมลที่มีสิทธิ์เข้าแอดมิน
- ตาราง `tournament_state` สำหรับสถานะจับคู่ Realtime
- ตาราง private `player_credentials` เก็บเฉพาะ hash ของรหัสกู้คืน
- ตาราง private `private_matches` สำหรับคู่ที่แอดมินล็อกไว้และยังไม่เปิดเผย
- Storage bucket `player-avatars`
- RLS policies แยกข้อมูล public/admin
- Realtime publication สำหรับ `tournament_state`

หน้า `/admin` ใช้อีเมลและรหัสผ่านจาก Supabase Authentication โดยอีเมลนั้นต้องอยู่ใน `admin_emails` ด้วย

หากเคยติดตั้งเวอร์ชันก่อนแล้ว ให้รัน `supabase/migrations/003_hidden_draw_and_player_identity.sql` เพิ่มได้เลยโดยไม่ต้องลบผู้เล่นเดิม ระบบจะกำหนด Public Player ID แบบ `DT-01`, `DT-02`, … ให้ข้อมูลเดิมอัตโนมัติ

ผู้เล่นที่สมัครก่อน migration 003 จะยังไม่มี Recovery Code ให้แอดมินเปิดการ์ดผู้เล่นใน `/admin` แล้วเลือกออกรหัสใหม่ ส่งให้เจ้าตัวผ่านช่องทางส่วนตัว รหัสเดิม (ถ้ามี) จะใช้ไม่ได้ทันที

ระบบปัจจุบันออกแบบสำหรับแคมเปญภายในองค์กร หากจะเผยแพร่ลิงก์สมัครสู่สาธารณะ ควรเพิ่ม CAPTCHA/rate limiting ที่ trusted server endpoint และตั้งงานลบไฟล์ค้างใน `player-avatars/pending/` ก่อนเปิดใช้งานจริง

อีเมลผู้เล่นไม่ได้บังคับและถูกนำออกจากฟอร์ม เพราะเวอร์ชันปัจจุบันยังไม่มีระบบส่งแจ้งเตือนทางอีเมล

## Deploy with GitHub + Vercel

1. Push โปรเจกต์ขึ้น GitHub โดยไม่ commit `.env.local`
2. ใน Vercel เลือก **Add New → Project** แล้ว import repository
3. เพิ่ม Environment Variables สองตัวเดียวกับ `.env.local`
4. Deploy — Vercel จะตรวจพบ Next.js และใช้ `npm run build` อัตโนมัติ
5. เพิ่ม Vercel domain ใน Supabase **Authentication → URL Configuration → Redirect URLs**

## Quality checks

```bash
npm test
npm run lint
npm run build
```

## Current scope

- Phase 1: Registration + Lobby
- Phase 2: Admin Control Room + Realtime Matchmaking Roulette
- Phase 3 ต่อไป: Smart Knockout Bracket และการกระจาย BYE แบบสมดุล
