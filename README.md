# Rapid Stage Scoring System (RSSS)

Internal-only, admin-authenticated officiating platform for live parachuting / parashooting competitions (8 athletes × 10 rounds, cascading eliminations).

## Quick start

```bash
npm install
# Make sure MongoDB is running locally on mongodb://localhost:27017
npm run dev
# Open http://localhost:3000  (default login: admin / admin123)
```

## Stack

- **Next.js 14 (App Router)** — single project, frontend + API
- **MongoDB** — collections: `athletes`, `scores`, `settings`, `competitions`
- **Tailwind + shadcn/ui** — government-sports-authority styling
- **Static Bearer token auth** (env-driven, upgrade path documented in spec)

## Environment variables (`.env.local`)

```
MONGO_URL=mongodb://localhost:27017
DB_NAME=rapid_stage_scoring
ADMIN_USER=admin
ADMIN_PASS=admin123
AUTH_TOKEN=rss-secret-token-2025
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## Competition rules (hardcoded)

| Setting | Value |
|---|---|
| Max athletes | 8 |
| Total rounds | 10 |
| Score range | 0.0 – 5.0 (step 0.1) |
| Eliminations | 1 after R4, then +1 after each round through R9 (6 total) |
| Finalists | 2 athletes after R9 |
| Tie-break | Lower competitor number wins |

`eliminationsAfterRound(r) = r < 4 ? 0 : min(6, r - 3)`

## Workflow

1. **Login** with admin credentials
2. **Athletes** tab → Add athletes manually or **Load Sample Roster** (8 athletes)
3. **Score Entry** tab → Enter scores 0–5 per athlete per round (autosaves on change, ~400ms debounce; Enter jumps to next athlete in same round)
4. **Lock & Advance** → Validates all active athletes scored for the next round, then advances and triggers elimination
5. **Rankings** updates live; **Final Standings** shows the gold/silver finalists after R9
6. **Export CSV** anytime; **Reset** archives current competition into **History** before wiping

## API surface (all under `/api`, all require `Authorization: Bearer <AUTH_TOKEN>` except login)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Returns token |
| GET | `/auth/verify` | Token check |
| GET | `/state` | Full state: athletes (with rounds, total, rank), currentRound, elimsTarget |
| POST | `/athletes` | Create (max 8) |
| PUT | `/athletes/:id` | Update |
| DELETE | `/athletes/:id` | Remove (also deletes their scores) |
| POST | `/scores` | Upsert one score `{athleteId, round, score}` |
| POST | `/rounds/advance` | Validates + advances; 400 with `missing[]` if active athletes lack the next round's score |
| POST | `/rounds/set` | Jump to specific round |
| POST | `/seed` | 8 sample athletes (only if empty) |
| POST | `/reset` | Archives current to `/competitions` then wipes |
| GET | `/competitions` | List archives |
| GET | `/competitions/:id` | Single archive |
| DELETE | `/competitions/:id` | Delete archive |
| GET | `/export/csv` | Download current standings as CSV |

## Production hardening (not yet wired)

- Swap static `AUTH_TOKEN` for JWT (HS256, 8h exp)
- Store admin password as bcrypt hash in `admins` collection
- Rate-limit `/auth/login`
- Add audit log of every score change
- Optional: XLSX / PDF export, multi-judge averaging, SSE scoreboard push
