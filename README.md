# Rapid Stage Scoring System (RSSS)

A professional web-based scoring and elimination management platform designed for official parachuting / parashooting competitions and sports judging events. Built for judges and competition officials to manage athlete scoring, real-time rankings, eliminations, and final standings through a clean admin dashboard.

Internal-only, admin-authenticated. 8 athletes × 10 rounds, cascading eliminations.

## Quick start (local)

```bash
npm install
# Make sure MongoDB is running locally on mongodb://localhost:27017
#   docker run -d -p 27017:27017 --name rsss-mongo mongo:7
npm run dev
# Open http://localhost:3000  (default login: admin / admin123)
```

## Stack

- **Next.js 14 (App Router)** — single project, frontend + API
- **MongoDB** — collections: `athletes`, `scores`, `settings`, `competitions`, `admins`
- **Tailwind + shadcn/ui** — government-sports-authority styling
- **JWT (HS256, 8h) + bcryptjs** — auth with hashed password in `admins` collection
- **exceljs / pdfkit** — XLSX and PDF export

## Environment variables (`.env.local` for dev, Vercel Project Settings for prod)

```
MONGO_URL=mongodb://127.0.0.1:27017       # for prod, an Atlas connection string
DB_NAME=rapid_stage_scoring
ADMIN_USER=admin                          # bootstraps the first admin record
ADMIN_PASS=admin123                       # bcrypt-hashed into the admins collection on first login
JWT_SECRET=change-me-rss-jwt-secret-2025  # MUST be a long random string in prod
JWT_EXPIRES_IN=8h
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## Competition rules (hardcoded)

| Setting | Value |
|---|---|
| Max athletes | 8 |
| Total rounds | 10 |
| Score range | 0.0 – 5.0 (step 0.1) |
| Eliminations | 1 after R4, then +1 after each round through R9 (6 total) |
| Finalists | 2 athletes after R9, scoring R10 |
| Tie-break | Higher total → higher latest round → higher previous round → higher competitor # |
| Final podium | Gold (1st), Silver (2nd), Bronze (3rd) |

`eliminationsAfterRound(r) = r < 4 ? 0 : min(6, r - 3)`

## Real-time behavior

- Score saves trigger `recomputeRankings`, which runs `autoProgress` first: if every active athlete has a score for `currentRound + 1`, the round auto-advances and elimination fires. Cascades across multiple rounds.
- Client polls `/api/state` every 3s, refetches on tab switch, and re-sorts the leaderboard with the same tie-break.

## Deploy to Vercel

1. Create a free MongoDB Atlas cluster (M0), allowlist `0.0.0.0/0`, copy the connection string.
2. Push this repo to GitHub.
3. Import on vercel.com → New Project → pick this repo → leave defaults.
4. Paste the env vars above (use the Atlas URL for `MONGO_URL` and a real `JWT_SECRET`).
5. Deploy. The first login bootstraps an admin from `ADMIN_USER` / `ADMIN_PASS`, bcrypt-hashed into the `admins` collection.

## API surface (all under `/api`, all require `Authorization: Bearer <JWT>` except login)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | bcrypt verify against admins collection, returns JWT |
| GET | `/auth/verify` | Token check |
| GET | `/state` | Auto-progresses rounds, returns ranked state |
| POST | `/athletes` | Create (max 8) |
| PUT | `/athletes/:id` | Update |
| DELETE | `/athletes/:id` | Remove (also deletes their scores) |
| POST | `/scores` | Upsert one score `{athleteId, round, score}` — rejects if athlete eliminated |
| POST | `/rounds/advance` | Manual checkpoint (mostly redundant with auto-progress) |
| POST | `/rounds/set` | Jump to specific round |
| POST | `/seed` | 8 sample athletes (only if empty) |
| POST | `/reset` | Archives current to `/competitions` then wipes |
| GET | `/competitions` | List archives |
| GET | `/competitions/:id` | Single archive |
| DELETE | `/competitions/:id` | Delete archive |
| GET | `/export/csv` | CSV download |
| GET | `/export/xlsx` | Excel download (styled, podium colors) |
| GET | `/export/pdf` | PDF download (landscape A4, navy header) |
