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

หากยังไม่มี Supabase ระบบจะทำงานเป็น **Local Demo Mode** โดยใช้ localStorage สามารถเพิ่มผู้เล่นตัวอย่างจากหน้าแอดมินและทดสอบ Roulette ได้ทันที

## Supabase setup

1. สร้างโปรเจกต์ใหม่ใน Supabase
2. เปิด **SQL Editor** แล้วรันไฟล์ `supabase/migrations/001_office_smash.sql`
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
- Storage bucket `player-avatars`
- RLS policies แยกข้อมูล public/admin
- Realtime publication สำหรับ `tournament_state`

หน้า `/admin` ใช้อีเมลและรหัสผ่านจาก Supabase Authentication โดยอีเมลนั้นต้องอยู่ใน `admin_emails` ด้วย

หากเคยรัน migration รุ่นก่อนแล้ว ให้รัน `supabase/migrations/002_optional_email_magic_link.sql` เพิ่ม โดยไม่ต้องลบข้อมูลเดิม

อีเมลผู้เล่นไม่ได้บังคับและถูกนำออกจากฟอร์ม เพราะเวอร์ชันปัจจุบันยังไม่มีระบบส่งแจ้งเตือนทางอีเมล

## Deploy with GitHub + Vercel

1. Push โปรเจกต์ขึ้น GitHub โดยไม่ commit `.env.local`
2. ใน Vercel เลือก **Add New → Project** แล้ว import repository
3. เพิ่ม Environment Variables สองตัวเดียวกับ `.env.local`
4. Deploy — Vercel จะตรวจพบ Next.js และใช้ `npm run build` อัตโนมัติ
5. เพิ่ม Vercel domain ใน Supabase **Authentication → URL Configuration → Redirect URLs**

## Quality checks

```bash
npm run lint
npm run build
```

## Current scope

- Phase 1: Registration + Lobby
- Phase 2: Admin Control Room + Realtime Matchmaking Roulette
- Phase 3 ต่อไป: Smart Knockout Bracket และการกระจาย BYE แบบสมดุล
