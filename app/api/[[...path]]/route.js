import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/mongodb";
import {
  bootstrapAdmins,
  verifyCredentials,
  signToken,
  verifyToken,
  extractBearer,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOTAL_ATHLETES_MAX = 8;
const TOTAL_ROUNDS = 10;
const SCORE_MIN = 0;
const SCORE_MAX = 5;

// ---------- helpers ----------

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function err(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function eliminationsAfterRound(r) {
  if (r < 4) return 0;
  return Math.min(6, r - 3);
}

function requireAuth(req) {
  const token = extractBearer(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return payload;
}

async function getSettings(db) {
  const s = await db.collection("settings").findOne({ _id: "main" });
  if (s) return s;
  const initial = { _id: "main", currentRound: 0 };
  await db.collection("settings").insertOne(initial);
  return initial;
}

async function persistSettings(db, patch) {
  await db.collection("settings").updateOne(
    { _id: "main" },
    { $set: patch },
    { upsert: true }
  );
}

// Multi-level tie-break used by every active-list sort:
//   1. Higher cumulative total
//   2. Higher latest scored-round score
//   3. Higher previous round score
//   4. Higher competitor number (per spec: lowest competitor number LOSES on tie)
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

// Real-time round progression. As soon as every still-active athlete has a
// score for the next round, currentRound auto-advances and the elimination
// for that round fires. Cascades — if the next round also has all scores,
// it advances again, until it can't. Persists currentRound and elimination
// state when changes occur.
async function autoProgress(db) {
  const settings = await getSettings(db);
  let currentRound = settings.currentRound || 0;
  const initialRound = currentRound;
  let changed = false;

  while (currentRound < TOTAL_ROUNDS) {
    const athletes = await db.collection("athletes").find({}).toArray();
    const active = athletes.filter((a) => a.status !== "eliminated");
    if (active.length === 0) break;

    const nextRound = currentRound + 1;
    const scoresForNext = await db
      .collection("scores")
      .find({ round: nextRound })
      .toArray();
    const scoredIds = new Set(scoresForNext.map((s) => s.athleteId));
    if (!active.every((a) => scoredIds.has(a.id))) break;

    currentRound = nextRound;
    changed = true;

    const target = eliminationsAfterRound(currentRound);
    const elimCount = athletes.length - active.length;
    const need = target - elimCount;

    if (need > 0) {
      const allScores = await db.collection("scores").find({}).toArray();
      const sba = {};
      for (const s of allScores) {
        if (!sba[s.athleteId]) sba[s.athleteId] = {};
        sba[s.athleteId][s.round] = s.score;
      }
      const view = active.map((a) => {
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
          ...a,
          rounds,
          total: Math.round(total * 10) / 10,
        };
      });
      view.sort(compareForRank);
      const toEliminate = view.slice(view.length - need);
      for (const a of toEliminate) {
        await db.collection("athletes").updateOne(
          { id: a.id },
          { $set: { status: "eliminated", eliminatedAfterRound: currentRound } }
        );
      }
    }
  }

  if (changed && currentRound !== initialRound) {
    await persistSettings(db, { currentRound });
  }
}

async function recomputeRankings(db) {
  // Real-time progression: auto-advance rounds and auto-eliminate before
  // computing the public view, so the response always reflects up-to-date state.
  await autoProgress(db);

  const settings = await getSettings(db);
  const currentRound = settings.currentRound || 0;
  const athletes = await db.collection("athletes").find({}).toArray();
  const scores = await db.collection("scores").find({}).toArray();

  const scoresByAthlete = {};
  for (const s of scores) {
    if (!scoresByAthlete[s.athleteId]) scoresByAthlete[s.athleteId] = {};
    scoresByAthlete[s.athleteId][s.round] = s.score;
  }

  // Build view objects
  let view = athletes.map((a) => {
    const rounds = {};
    let total = 0;
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      const v = scoresByAthlete[a.id]?.[r];
      if (typeof v === "number") {
        rounds[r] = v;
        total += v;
      } else {
        rounds[r] = null;
      }
    }
    return {
      id: a.id,
      fullName: a.fullName,
      competitorNumber: a.competitorNumber,
      country: a.country || "",
      photo: a.photo || "",
      status: a.status || "active",
      eliminatedAfterRound: a.eliminatedAfterRound ?? null,
      createdAt: a.createdAt,
      rounds,
      total: Math.round(total * 10) / 10,
    };
  });

  const active = view.filter((v) => v.status !== "eliminated");
  const eliminated = view.filter((v) => v.status === "eliminated");

  active.sort(compareForRank);

  const target = eliminationsAfterRound(currentRound);
  const needToEliminate = Math.max(0, target - eliminated.length);

  if (needToEliminate > 0 && active.length > 0) {
    // Eliminate lowest active athletes (last in sorted list)
    const toEliminate = active.slice(active.length - needToEliminate);
    for (const a of toEliminate) {
      a.status = "eliminated";
      a.eliminatedAfterRound = currentRound;
      await db.collection("athletes").updateOne(
        { id: a.id },
        { $set: { status: "eliminated", eliminatedAfterRound: currentRound } }
      );
    }
    const stillActive = active.slice(0, active.length - needToEliminate);
    eliminated.push(...toEliminate);
    active.length = 0;
    active.push(...stillActive);
  }

  active.sort(compareForRank);
  eliminated.sort((a, b) => {
    if ((b.eliminatedAfterRound ?? 0) !== (a.eliminatedAfterRound ?? 0)) {
      return (b.eliminatedAfterRound ?? 0) - (a.eliminatedAfterRound ?? 0);
    }
    return compareForRank(a, b);
  });

  let rank = 1;
  const ranked = [];
  for (const a of active) {
    ranked.push({ ...a, rank: rank++ });
  }
  for (const a of eliminated) {
    ranked.push({ ...a, rank: rank++ });
  }

  return {
    athletes: ranked,
    currentRound,
    elimsTarget: target,
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

  // Auth: login (no token required). Needs the DB for the admins collection.
  if (path === "/auth/login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { username, password } = body || {};
    if (!username || !password) return err("Username and password required", 400);
    const db = await getDb();
    const user = await verifyCredentials(db, username, password);
    if (!user) return err("Invalid credentials", 401);
    const token = signToken(user);
    return json({ token, user: { username: user.username } });
  }

  // All other routes require a valid JWT.
  const authedUser = requireAuth(req);
  if (!authedUser) return err("Unauthorized", 401);

  // /auth/verify is the only authed route that does not need the DB.
  if (path === "/auth/verify" && method === "GET") {
    return json({ ok: true, user: { username: authedUser.username } });
  }

  const db = await getDb();

  // STATE
  if (path === "/state" && method === "GET") {
    const state = await recomputeRankings(db);
    return json(state);
  }

  // ATHLETES
  if (path === "/athletes" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { fullName, competitorNumber, country, photo } = body || {};
    if (!fullName || typeof fullName !== "string") return err("fullName is required");
    const numCount = await db.collection("athletes").countDocuments({});
    if (numCount >= TOTAL_ATHLETES_MAX) return err(`Maximum ${TOTAL_ATHLETES_MAX} athletes allowed`);
    const compNum = parseInt(competitorNumber, 10);
    if (!Number.isInteger(compNum) || compNum < 1 || compNum > TOTAL_ATHLETES_MAX) {
      return err(`competitorNumber must be 1..${TOTAL_ATHLETES_MAX}`);
    }
    const dup = await db.collection("athletes").findOne({ competitorNumber: compNum });
    if (dup) return err(`Competitor number ${compNum} already taken`);
    const doc = {
      id: uuidv4(),
      fullName: fullName.trim(),
      competitorNumber: compNum,
      country: (country || "").trim(),
      photo: (photo || "").trim(),
      status: "active",
      eliminatedAfterRound: null,
      createdAt: new Date().toISOString(),
    };
    await db.collection("athletes").insertOne(doc);
    return json(doc, 201);
  }

  if (path.startsWith("/athletes/") && method === "PUT") {
    const id = segments[1];
    const body = await req.json().catch(() => ({}));
    const patch = {};
    if (typeof body.fullName === "string") patch.fullName = body.fullName.trim();
    if (typeof body.country === "string") patch.country = body.country.trim();
    if (typeof body.photo === "string") patch.photo = body.photo.trim();
    if (body.competitorNumber != null) {
      const n = parseInt(body.competitorNumber, 10);
      if (!Number.isInteger(n) || n < 1 || n > TOTAL_ATHLETES_MAX) {
        return err(`competitorNumber must be 1..${TOTAL_ATHLETES_MAX}`);
      }
      const dup = await db.collection("athletes").findOne({ competitorNumber: n, id: { $ne: id } });
      if (dup) return err(`Competitor number ${n} already taken`);
      patch.competitorNumber = n;
    }
    const result = await db.collection("athletes").updateOne({ id }, { $set: patch });
    if (result.matchedCount === 0) return err("Athlete not found", 404);
    return json({ ok: true });
  }

  if (path.startsWith("/athletes/") && method === "DELETE") {
    const id = segments[1];
    await db.collection("athletes").deleteOne({ id });
    await db.collection("scores").deleteMany({ athleteId: id });
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
    const athlete = await db.collection("athletes").findOne({ id: athleteId });
    if (!athlete) return err("Athlete not found", 404);
    if (athlete.status === "eliminated") return err("Cannot score an eliminated athlete");

    await db.collection("scores").updateOne(
      { athleteId, round: r },
      { $set: { athleteId, round: r, score, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return json({ ok: true });
  }

  // ROUNDS - advance
  if (path === "/rounds/advance" && method === "POST") {
    const settings = await getSettings(db);
    const current = settings.currentRound || 0;
    if (current >= TOTAL_ROUNDS) return err("Already at the final round");
    const nextRound = current + 1;
    // Validate all active athletes have a score for nextRound
    const activeAthletes = await db.collection("athletes").find({ status: { $ne: "eliminated" } }).toArray();
    if (activeAthletes.length === 0) return err("No active athletes to score");
    const scoresForRound = await db.collection("scores").find({ round: nextRound }).toArray();
    const scoredIds = new Set(scoresForRound.map((s) => s.athleteId));
    const missing = activeAthletes.filter((a) => !scoredIds.has(a.id));
    if (missing.length > 0) {
      return err(
        `Missing scores for round ${nextRound}`,
        400,
        { missing: missing.map((m) => ({ id: m.id, name: m.fullName, competitorNumber: m.competitorNumber })) }
      );
    }
    await persistSettings(db, { currentRound: nextRound });
    const state = await recomputeRankings(db);
    return json(state);
  }

  if (path === "/rounds/set" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const r = parseInt(body.round, 10);
    if (!Number.isInteger(r) || r < 0 || r > TOTAL_ROUNDS) {
      return err(`round must be 0..${TOTAL_ROUNDS}`);
    }
    await persistSettings(db, { currentRound: r });
    const state = await recomputeRankings(db);
    return json(state);
  }

  // SEED
  if (path === "/seed" && method === "POST") {
    const existing = await db.collection("athletes").countDocuments({});
    if (existing > 0) return err("Athletes already exist. Reset first.");
    const sample = [
      { fullName: "Anna Schmidt", country: "Germany" },
      { fullName: "James O'Connor", country: "Ireland" },
      { fullName: "Priya Sharma", country: "India" },
      { fullName: "Lucas Pereira", country: "Brazil" },
      { fullName: "Yuki Tanaka", country: "Japan" },
      { fullName: "Olivia Carter", country: "United Kingdom" },
      { fullName: "Mateusz Kowalski", country: "Poland" },
      { fullName: "Sofia Rossi", country: "Italy" },
    ];
    const docs = sample.map((s, i) => ({
      id: uuidv4(),
      fullName: s.fullName,
      competitorNumber: i + 1,
      country: s.country,
      photo: "",
      status: "active",
      eliminatedAfterRound: null,
      createdAt: new Date().toISOString(),
    }));
    await db.collection("athletes").insertMany(docs);
    return json({ ok: true, count: docs.length });
  }

  // RESET
  if (path === "/reset" && method === "POST") {
    // Archive current competition first if any data exists
    const athletes = await db.collection("athletes").find({}).toArray();
    if (athletes.length > 0) {
      const state = await recomputeRankings(db);
      const settings = await getSettings(db);
      const body = await req.json().catch(() => ({}));
      const name = (body && typeof body.name === "string" && body.name.trim())
        || `Competition ${new Date().toISOString().slice(0, 10)}`;
      await db.collection("competitions").insertOne({
        id: uuidv4(),
        name,
        archivedAt: new Date().toISOString(),
        currentRound: settings.currentRound || 0,
        athletes: state.athletes,
      });
    }
    await db.collection("athletes").deleteMany({});
    await db.collection("scores").deleteMany({});
    await db.collection("settings").updateOne({ _id: "main" }, { $set: { currentRound: 0 } }, { upsert: true });
    return json({ ok: true });
  }

  // COMPETITION HISTORY
  if (path === "/competitions" && method === "GET") {
    const items = await db
      .collection("competitions")
      .find({}, { projection: { _id: 0 } })
      .sort({ archivedAt: -1 })
      .toArray();
    return json({ items });
  }

  if (path.startsWith("/competitions/") && method === "GET") {
    const id = segments[1];
    const item = await db.collection("competitions").findOne({ id }, { projection: { _id: 0 } });
    if (!item) return err("Competition not found", 404);
    return json(item);
  }

  if (path.startsWith("/competitions/") && method === "DELETE") {
    const id = segments[1];
    await db.collection("competitions").deleteOne({ id });
    return json({ ok: true });
  }

  // EXPORT CSV
  if (path === "/export/csv" && method === "GET") {
    const state = await recomputeRankings(db);
    const headers = [
      "Rank",
      "Competitor #",
      "Full Name",
      "Country",
      ...Array.from({ length: TOTAL_ROUNDS }, (_, i) => `R${i + 1}`),
      "Total",
      "Status",
    ];
    const rows = state.athletes.map((a) => {
      const roundCols = [];
      for (let r = 1; r <= TOTAL_ROUNDS; r++) {
        const v = a.rounds[r];
        roundCols.push(v == null ? "" : String(v));
      }
      const escape = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
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
    const state = await recomputeRankings(db);
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
    const state = await recomputeRankings(db);
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on("end", resolve));

    // Header
    doc.fillColor("#0a2540").rect(36, 36, doc.page.width - 72, 56).fill();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text("RAPID STAGE SCORING SYSTEM", 48, 50);
    doc.font("Helvetica").fontSize(10).text("Official Competition Results", 48, 72);
    doc.fontSize(9).text(new Date().toLocaleString(), doc.page.width - 200, 72, { width: 150, align: "right" });

    let y = 110;
    doc.fillColor("#0a2540").font("Helvetica-Bold").fontSize(11)
      .text(`Round ${state.currentRound} of ${TOTAL_ROUNDS} · ${state.activeCount} active · ${state.athletes.length - state.activeCount} eliminated`, 36, y);
    y += 22;

    // Table headers
    const colX = [36, 70, 110, 230, 320];
    for (let r = 1; r <= TOTAL_ROUNDS; r++) colX.push(colX[colX.length - 1] + 32);
    colX.push(colX[colX.length - 1] + 42); // Total
    colX.push(colX[colX.length - 1] + 54); // Status
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

    // Footer
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

// Next.js handler exports
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
