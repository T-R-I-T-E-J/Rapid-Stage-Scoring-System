import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSql, sql } from "@/lib/db";
import {
  verifyCredentials,
  signToken,
  verifyToken,
  extractBearer,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOTAL_ATHLETES_MAX = 8;
const TOTAL_ROUNDS = 24;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

// ---------- helpers ----------

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function err(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function requireAuth(req) {
  const token = extractBearer(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return payload;
}

// Multi-level tie-break: total DESC → latest-scored-round DESC → previous-round DESC → competitor # DESC
function latestScoredRound(x) {
  for (let r = TOTAL_ROUNDS; r >= 1; r--) {
    if (x.rounds[r] != null) return r;
  }
  return 0;
}
function compareForRank(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  const lA = latestScoredRound(a);
  const lB = latestScoredRound(b);
  const maxR = Math.max(lA, lB);
  if (maxR > 0) {
    const sA = a.rounds[maxR] ?? -1;
    const sB = b.rounds[maxR] ?? -1;
    if (sB !== sA) return sB - sA;
    if (maxR > 1) {
      const pA = a.rounds[maxR - 1] ?? -1;
      const pB = b.rounds[maxR - 1] ?? -1;
      if (pB !== pA) return pB - pA;
    }
  }
  return b.competitorNumber - a.competitorNumber;
}

// Build per-athlete rounds map + total from a flat scores array.
function buildScoresIndex(scores) {
  const sba = {};
  for (const s of scores) {
    if (!sba[s.athlete_id]) sba[s.athlete_id] = {};
    sba[s.athlete_id][s.round] = Number(s.score);
  }
  return sba;
}

function athleteRow(a, sba) {
  const rounds = {};
  let total = 0;
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    const v = sba[a.id]?.[r];
    if (typeof v === "number") {
      rounds[r] = v;
      total += v;
    } else {
      rounds[r] = null;
    }
  }
  return {
    id: a.id,
    fullName: a.full_name,
    competitorNumber: a.competitor_number,
    country: a.country || "",
    photo: a.photo || "",
    status: a.status || "active",
    eliminatedAfterRound: a.eliminated_after_round ?? null,
    createdAt: a.created_at,
    rounds,
    total: Math.round(total * 10) / 10,
  };
}

async function getSettings() {
  const { rows } = await sql`SELECT current_round FROM settings WHERE id = 'main'`;
  if (rows.length) return { currentRound: rows[0].current_round };
  await sql`INSERT INTO settings (id, current_round) VALUES ('main', 0) ON CONFLICT (id) DO NOTHING`;
  return { currentRound: 0 };
}

async function persistCurrentRound(r) {
  await sql`UPDATE settings SET current_round = ${r} WHERE id = 'main'`;
}

// Real-time round progression. As soon as every still-active shooter has a
// score for the next shot, currentRound auto-advances. Eliminations are now
// manual only (see POST /athletes/:id/eliminate), so no eliminations fire here.
async function autoProgress() {
  const { currentRound: startRound } = await getSettings();
  let currentRound = startRound;

  while (currentRound < TOTAL_ROUNDS) {
    const { rows: athletes } = await sql`SELECT id, status FROM athletes`;
    const active = athletes.filter((a) => a.status !== "eliminated");
    if (active.length === 0) break;

    const nextRound = currentRound + 1;
    const { rows: scoresForNext } = await sql`SELECT athlete_id FROM scores WHERE round = ${nextRound}`;
    const scoredIds = new Set(scoresForNext.map((s) => s.athlete_id));
    if (!active.every((a) => scoredIds.has(a.id))) break;

    currentRound = nextRound;
  }

  if (currentRound !== startRound) {
    await persistCurrentRound(currentRound);
  }
}

async function recomputeRankings() {
  await autoProgress();

  const { currentRound } = await getSettings();
  const { rows: athletes } = await sql`SELECT id, full_name, competitor_number, country, photo, status, eliminated_after_round, created_at FROM athletes`;
  const { rows: scores } = await sql`SELECT athlete_id, round, score FROM scores`;
  const sba = buildScoresIndex(scores);

  const view = athletes.map((a) => athleteRow(a, sba));
  const active = view.filter((v) => v.status !== "eliminated").slice().sort(compareForRank);
  const eliminated = view.filter((v) => v.status === "eliminated").slice().sort((a, b) => {
    if ((b.eliminatedAfterRound ?? 0) !== (a.eliminatedAfterRound ?? 0)) {
      return (b.eliminatedAfterRound ?? 0) - (a.eliminatedAfterRound ?? 0);
    }
    return compareForRank(a, b);
  });

  let rank = 1;
  const ranked = [];
  for (const a of active) ranked.push({ ...a, rank: rank++ });
  for (const a of eliminated) ranked.push({ ...a, rank: rank++ });

  return {
    athletes: ranked,
    currentRound,
    activeCount: active.length,
    totalAthletes: ranked.length,
    totalRounds: TOTAL_ROUNDS,
    maxAthletes: TOTAL_ATHLETES_MAX,
  };
}

function validateScore(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n < SCORE_MIN || n > SCORE_MAX) return null;
  return Math.round(n * 10) / 10;
}

// ---------- route map ----------

async function dispatch(req, segments, method) {
  const path = "/" + segments.join("/");

  // Auth: login — needs DB schema ready
  if (path === "/auth/login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { username, password } = body || {};
    if (!username || !password) return err("Username and password required", 400);
    await getSql(); // ensure schema before bootstrap
    const user = await verifyCredentials(username, password);
    if (!user) return err("Invalid credentials", 401);
    const token = signToken(user);
    return json({ token, user: { username: user.username } });
  }

  const authedUser = requireAuth(req);
  if (!authedUser) return err("Unauthorized", 401);

  if (path === "/auth/verify" && method === "GET") {
    return json({ ok: true, user: { username: authedUser.username } });
  }

  // Every other authed route needs the schema.
  await getSql();

  // STATE
  if (path === "/state" && method === "GET") {
    return json(await recomputeRankings());
  }

  // ATHLETES
  if (path === "/athletes" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { fullName, competitorNumber, country, photo } = body || {};
    if (!fullName || typeof fullName !== "string") return err("fullName is required");
    const { rows: countRows } = await sql`SELECT COUNT(*)::int AS c FROM athletes`;
    if (countRows[0].c >= TOTAL_ATHLETES_MAX) return err(`Maximum ${TOTAL_ATHLETES_MAX} athletes allowed`);
    const compNum = parseInt(competitorNumber, 10);
    if (!Number.isInteger(compNum) || compNum < 1 || compNum > TOTAL_ATHLETES_MAX) {
      return err(`competitorNumber must be 1..${TOTAL_ATHLETES_MAX}`);
    }
    const { rows: dup } = await sql`SELECT id FROM athletes WHERE competitor_number = ${compNum}`;
    if (dup.length) return err(`Competitor number ${compNum} already taken`);
    const id = uuidv4();
    const fn = fullName.trim();
    const co = (country || "").trim();
    const ph = (photo || "").trim();
    await sql`
      INSERT INTO athletes (id, full_name, competitor_number, country, photo, status)
      VALUES (${id}, ${fn}, ${compNum}, ${co}, ${ph}, 'active')
    `;
    return json({ id, fullName: fn, competitorNumber: compNum, country: co, photo: ph, status: "active" }, 201);
  }

  if (path.startsWith("/athletes/") && method === "PUT") {
    const id = segments[1];
    const body = await req.json().catch(() => ({}));
    // Apply each provided field with a separate UPDATE — keeps query simple
    // for a 1-row admin op. The whole thing is sub-ms regardless.
    if (typeof body.fullName === "string") {
      await sql`UPDATE athletes SET full_name = ${body.fullName.trim()} WHERE id = ${id}`;
    }
    if (typeof body.country === "string") {
      await sql`UPDATE athletes SET country = ${body.country.trim()} WHERE id = ${id}`;
    }
    if (typeof body.photo === "string") {
      await sql`UPDATE athletes SET photo = ${body.photo.trim()} WHERE id = ${id}`;
    }
    if (body.competitorNumber != null) {
      const n = parseInt(body.competitorNumber, 10);
      if (!Number.isInteger(n) || n < 1 || n > TOTAL_ATHLETES_MAX) {
        return err(`competitorNumber must be 1..${TOTAL_ATHLETES_MAX}`);
      }
      const { rows: dup } = await sql`SELECT id FROM athletes WHERE competitor_number = ${n} AND id <> ${id}`;
      if (dup.length) return err(`Competitor number ${n} already taken`);
      await sql`UPDATE athletes SET competitor_number = ${n} WHERE id = ${id}`;
    }
    return json({ ok: true });
  }

  // Manual elimination — one-way. Marks the selected shooter eliminated and
  // records the shot/round they were eliminated after (the current round).
  if (path.startsWith("/athletes/") && segments[2] === "eliminate" && method === "POST") {
    const id = segments[1];
    const { rows: aRows } = await sql`SELECT id, status FROM athletes WHERE id = ${id}`;
    if (!aRows.length) return err("Athlete not found", 404);
    if (aRows[0].status === "eliminated") return err("Athlete is already eliminated");
    const { currentRound } = await getSettings();
    await sql`UPDATE athletes SET status = 'eliminated', eliminated_after_round = ${currentRound} WHERE id = ${id}`;
    return json(await recomputeRankings());
  }

  // Reinstate — the other half of the toggle. Returns a shooter to active and
  // clears their elimination round. Their recorded scores are untouched.
  if (path.startsWith("/athletes/") && segments[2] === "reinstate" && method === "POST") {
    const id = segments[1];
    const { rows: aRows } = await sql`SELECT id FROM athletes WHERE id = ${id}`;
    if (!aRows.length) return err("Athlete not found", 404);
    await sql`UPDATE athletes SET status = 'active', eliminated_after_round = NULL WHERE id = ${id}`;
    return json(await recomputeRankings());
  }

  if (path.startsWith("/athletes/") && method === "DELETE") {
    const id = segments[1];
    // ON DELETE CASCADE on scores.athlete_id handles the scores rows.
    await sql`DELETE FROM athletes WHERE id = ${id}`;
    return json({ ok: true });
  }

  // SCORES
  if (path === "/scores" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { athleteId, round } = body || {};
    const r = parseInt(round, 10);
    if (!Number.isInteger(r) || r < 1 || r > TOTAL_ROUNDS) {
      return err(`round must be an integer 1..${TOTAL_ROUNDS}`);
    }
    const score = validateScore(body.score);
    if (score === null) return err(`score must be a number ${SCORE_MIN}..${SCORE_MAX}`);
    const { rows: aRows } = await sql`SELECT id, status FROM athletes WHERE id = ${athleteId}`;
    if (!aRows.length) return err("Athlete not found", 404);
    if (aRows[0].status === "eliminated") return err("Cannot score an eliminated athlete");
    await sql`
      INSERT INTO scores (athlete_id, round, score, updated_at)
      VALUES (${athleteId}, ${r}, ${score}, NOW())
      ON CONFLICT (athlete_id, round)
      DO UPDATE SET score = EXCLUDED.score, updated_at = NOW()
    `;
    return json({ ok: true });
  }

  // ROUNDS
  if (path === "/rounds/advance" && method === "POST") {
    const { currentRound: current } = await getSettings();
    if (current >= TOTAL_ROUNDS) return err("Already at the final round");
    const nextRound = current + 1;
    const { rows: actives } = await sql`SELECT id, full_name, competitor_number FROM athletes WHERE status <> 'eliminated'`;
    if (actives.length === 0) return err("No active athletes to score");
    const { rows: scoresForRound } = await sql`SELECT athlete_id FROM scores WHERE round = ${nextRound}`;
    const scoredIds = new Set(scoresForRound.map((s) => s.athlete_id));
    const missing = actives.filter((a) => !scoredIds.has(a.id));
    if (missing.length > 0) {
      return err(`Missing scores for round ${nextRound}`, 400, {
        missing: missing.map((m) => ({ id: m.id, name: m.full_name, competitorNumber: m.competitor_number })),
      });
    }
    await persistCurrentRound(nextRound);
    return json(await recomputeRankings());
  }

  if (path === "/rounds/set" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const r = parseInt(body.round, 10);
    if (!Number.isInteger(r) || r < 0 || r > TOTAL_ROUNDS) {
      return err(`round must be 0..${TOTAL_ROUNDS}`);
    }
    await persistCurrentRound(r);
    return json(await recomputeRankings());
  }

  // SEED — loads the competition roster. Idempotent and non-destructive:
  // adds any shooter whose competitor number isn't taken yet, leaving existing
  // athletes and their scores untouched. Safe to click mid-competition.
  if (path === "/seed" && method === "POST") {
    const sample = [
      { fullName: "Sanjeev Giri", country: "TN" },
      { fullName: "Manish Narwal", country: "HAR" },
      { fullName: "Rudransh Khandelwal", country: "RAJ" },
      { fullName: "Amir Ahmad Bhat", country: "Army" },
      { fullName: "Santosh Vithoda Gadhe", country: "MAH" },
      { fullName: "Shivraj Sankhala", country: "RAJ" },
      { fullName: "Akash", country: "UP" },
      { fullName: "Ajay Kumar", country: "BIH" },
    ];
    let inserted = 0;
    for (let i = 0; i < sample.length; i++) {
      const s = sample[i];
      const { rowCount } = await sql`
        INSERT INTO athletes (id, full_name, competitor_number, country, status)
        VALUES (${uuidv4()}, ${s.fullName}, ${i + 1}, ${s.country}, 'active')
        ON CONFLICT (competitor_number) DO NOTHING
      `;
      inserted += rowCount || 0;
    }
    return json({ ok: true, count: inserted });
  }

  // RESET — archives current to competitions, then wipes athletes/scores/settings
  if (path === "/reset" && method === "POST") {
    const { rows: athletesRows } = await sql`SELECT id FROM athletes`;
    if (athletesRows.length > 0) {
      const state = await recomputeRankings();
      const body = await req.json().catch(() => ({}));
      const name = (body && typeof body.name === "string" && body.name.trim())
        || `Competition ${new Date().toISOString().slice(0, 10)}`;
      await sql`
        INSERT INTO competitions (id, name, current_round, athletes)
        VALUES (${uuidv4()}, ${name}, ${state.currentRound}, ${JSON.stringify(state.athletes)}::jsonb)
      `;
    }
    await sql`DELETE FROM athletes`;
    // scores are cascade-deleted; settings reset:
    await persistCurrentRound(0);
    return json({ ok: true });
  }

  // COMPETITION HISTORY
  if (path === "/competitions" && method === "GET") {
    const { rows } = await sql`SELECT id, name, archived_at, current_round, athletes FROM competitions ORDER BY archived_at DESC`;
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      archivedAt: r.archived_at,
      currentRound: r.current_round,
      athletes: r.athletes,
    }));
    return json({ items });
  }

  if (path.startsWith("/competitions/") && method === "GET") {
    const id = segments[1];
    const { rows } = await sql`SELECT id, name, archived_at, current_round, athletes FROM competitions WHERE id = ${id}`;
    if (!rows.length) return err("Competition not found", 404);
    const r = rows[0];
    return json({
      id: r.id,
      name: r.name,
      archivedAt: r.archived_at,
      currentRound: r.current_round,
      athletes: r.athletes,
    });
  }

  if (path.startsWith("/competitions/") && method === "DELETE") {
    const id = segments[1];
    await sql`DELETE FROM competitions WHERE id = ${id}`;
    return json({ ok: true });
  }

  // EXPORT CSV
  if (path === "/export/csv" && method === "GET") {
    const state = await recomputeRankings();
    const headers = [
      "Rank",
      "Competitor #",
      "Full Name",
      "Country",
      ...Array.from({ length: TOTAL_ROUNDS }, (_, i) => `R${i + 1}`),
      "Total",
      "Status",
    ];
    const escape = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = state.athletes.map((a) => {
      const roundCols = [];
      for (let r = 1; r <= TOTAL_ROUNDS; r++) {
        const v = a.rounds[r];
        roundCols.push(v == null ? "" : String(v));
      }
      return [
        a.rank,
        String(a.competitorNumber).padStart(2, "0"),
        escape(a.fullName),
        escape(a.country),
        ...roundCols,
        a.total.toFixed(1),
        a.status,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="competition-results-${date}.csv"`,
      },
    });
  }

  if (path === "/export/xlsx" && method === "GET") {
    const state = await recomputeRankings();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Rapid Stage Scoring System";
    wb.created = new Date();
    const ws = wb.addWorksheet("Results");
    const cols = [
      { header: "Rank", key: "rank", width: 6 },
      { header: "Competitor #", key: "num", width: 12 },
      { header: "Full Name", key: "name", width: 28 },
      { header: "Country", key: "country", width: 18 },
    ];
    for (let r = 1; r <= TOTAL_ROUNDS; r++) cols.push({ header: `R${r}`, key: `r${r}`, width: 7 });
    cols.push({ header: "Total", key: "total", width: 9 });
    cols.push({ header: "Status", key: "status", width: 14 });
    cols.push({ header: "Eliminated After", key: "elimAfter", width: 16 });
    ws.columns = cols;
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2540" } };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    for (const a of state.athletes) {
      const row = {
        rank: a.rank,
        num: String(a.competitorNumber).padStart(2, "0"),
        name: a.fullName,
        country: a.country || "",
        total: Number(a.total.toFixed(1)),
        status: a.status === "eliminated" ? "Eliminated" : "Active",
        elimAfter: a.eliminatedAfterRound ? `R${a.eliminatedAfterRound}` : "",
      };
      for (let r = 1; r <= TOTAL_ROUNDS; r++) row[`r${r}`] = a.rounds[r] ?? "";
      const added = ws.addRow(row);
      added.alignment = { vertical: "middle" };
      if (a.status === "eliminated") {
        added.font = { color: { argb: "FF6B7280" }, italic: true };
      }
      if (a.rank === 1) added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      else if (a.rank === 2) added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      else if (a.rank === 3) added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEDD5" } };
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="competition-results-${date}.xlsx"`,
      },
    });
  }

  if (path === "/export/pdf" && method === "GET") {
    const state = await recomputeRankings();
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on("end", resolve));

    doc.fillColor("#0a2540").rect(36, 36, doc.page.width - 72, 56).fill();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text("RAPID STAGE SCORING SYSTEM", 48, 50);
    doc.font("Helvetica").fontSize(10).text("Official Competition Results", 48, 72);
    doc.fontSize(9).text(new Date().toLocaleString(), doc.page.width - 200, 72, { width: 150, align: "right" });

    let y = 110;
    doc.fillColor("#0a2540").font("Helvetica-Bold").fontSize(11)
      .text(`Round ${state.currentRound} of ${TOTAL_ROUNDS} · ${state.activeCount} active · ${state.athletes.length - state.activeCount} eliminated`, 36, y);
    y += 22;

    const colX = [36, 70, 110, 230, 320];
    for (let r = 1; r <= TOTAL_ROUNDS; r++) colX.push(colX[colX.length - 1] + 32);
    colX.push(colX[colX.length - 1] + 42);
    colX.push(colX[colX.length - 1] + 54);
    const headers = ["#", "No.", "Athlete", "Country"];
    for (let r = 1; r <= TOTAL_ROUNDS; r++) headers.push(`R${r}`);
    headers.push("Total", "Status");

    doc.fillColor("#0a2540").rect(36, y, doc.page.width - 72, 20).fill();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
    headers.forEach((h, i) => doc.text(h, colX[i] + 2, y + 6, { width: 30, align: i < 4 ? "left" : "center" }));
    y += 20;

    doc.font("Helvetica").fontSize(8.5);
    for (const a of state.athletes) {
      const isElim = a.status === "eliminated";
      const rowBg = a.rank === 1 ? "#fef3c7" : a.rank === 2 ? "#f1f5f9" : a.rank === 3 ? "#ffedd5" : isElim ? "#f9fafb" : "#ffffff";
      doc.fillColor(rowBg).rect(36, y, doc.page.width - 72, 18).fill();
      doc.fillColor(isElim ? "#6b7280" : "#0f172a");
      const cells = [
        String(a.rank),
        String(a.competitorNumber).padStart(2, "0"),
        a.fullName,
        a.country || "—",
      ];
      for (let r = 1; r <= TOTAL_ROUNDS; r++) cells.push(a.rounds[r] != null ? String(a.rounds[r]) : "");
      cells.push(a.total.toFixed(1));
      cells.push(isElim ? `Out R${a.eliminatedAfterRound}` : "Active");
      cells.forEach((c, i) => doc.text(c, colX[i] + 2, y + 5, { width: 30, align: i < 4 ? "left" : "center" }));
      y += 18;
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }
    }

    doc.fillColor("#94a3b8").font("Helvetica").fontSize(8)
      .text("Rapid Stage Scoring System · Internal Officiating Document", 36, doc.page.height - 30);

    doc.end();
    await done;
    const buf = Buffer.concat(chunks);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="competition-results-${date}.pdf"`,
      },
    });
  }

  return err("Not found", 404);
}

// ---------- Next.js handlers ----------

async function handle(req, ctx, method) {
  try {
    const params = await ctx.params;
    const path = Array.isArray(params?.path) ? params.path : [];
    return await dispatch(req, path, method);
  } catch (e) {
    console.error("API error:", e);
    return err(e.message || "Internal error", 500);
  }
}

export async function GET(req, ctx) { return handle(req, ctx, "GET"); }
export async function POST(req, ctx) { return handle(req, ctx, "POST"); }
export async function PUT(req, ctx) { return handle(req, ctx, "PUT"); }
export async function DELETE(req, ctx) { return handle(req, ctx, "DELETE"); }
export async function PATCH(req, ctx) { return handle(req, ctx, "PATCH"); }
