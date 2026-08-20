# OFFICE SMASH — Ping Pong Tournament

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
3. ไปที่ **Authentication → Users** แล้วสร้างผู้ใช้แอดมินแบบ Email/Password
4. เปิด SQL Editor แล้วเพิ่มสิทธิ์ให้ผู้ใช้นั้น:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'admin@your-company.com';
```

5. คัดลอก `.env.example` เป็น `.env.local` แล้วกรอกค่า:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Migration จะสร้าง:

- ตาราง `players` สำหรับข้อมูลผู้สมัคร
- ตาราง `admin_users` สำหรับสิทธิ์ผู้จัด
- ตาราง `tournament_state` สำหรับสถานะจับคู่ Realtime
- Storage bucket `player-avatars`
- RLS policies แยกข้อมูล public/admin
- Realtime publication สำหรับ `tournament_state`

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
