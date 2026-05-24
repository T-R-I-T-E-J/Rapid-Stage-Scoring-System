"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Shield,
  LogOut,
  Lock,
  Download,
  RotateCcw,
  ChevronRight,
  Trophy,
  Users,
  Activity,
  Crown,
  Medal,
  Award,
  Plus,
  Pencil,
  Trash2,
  UserX,
  UserCheck,
  Archive,
  History,
  Eye,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const TOKEN_KEY = "rss_token";
const TOTAL_ROUNDS = 24;
const MAX_ATHLETES = 8;
const SCORE_MAX = 100;

// ---------- API client ----------

function getToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

async function api(path, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
    throw new Error("Unauthorized");
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) {
      const e = new Error(data?.error || "Request failed");
      e.payload = data;
      throw e;
    }
    return data;
  }
  if (!res.ok) throw new Error("Request failed");
  return res;
}

// ---------- Login Screen ----------

function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Invalid credentials");
      window.localStorage.setItem(TOKEN_KEY, data.token);
      onLoggedIn(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50">
      <Card className="w-full max-w-md border-slate-200 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#0a2540] text-white">
            <Shield className="h-7 w-7" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight text-slate-900">
            Rapid Stage Scoring System
          </CardTitle>
          <CardDescription className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wider text-slate-500 mt-1">
            <Lock className="h-3 w-3" />
            Authorized Personnel Only
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs uppercase tracking-wide text-slate-600">
                Username
              </Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs uppercase tracking-wide text-slate-600">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full bg-[#0a2540] hover:bg-[#0a2540]/90"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
            <p className="text-[11px] text-center text-slate-400 pt-1">
              Default: <span className="font-mono">admin / admin123</span>
              <span className="block mt-0.5">Remove this hint before production deployment.</span>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Score Cell (debounced autosave) ----------

function ScoreCell({ athleteId, round, value, disabled, onSaved, registerInput }) {
  const [val, setVal] = useState(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [errored, setErrored] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const lastSavedRef = useRef(value == null ? "" : String(value));

  useEffect(() => {
    setVal(value == null ? "" : String(value));
    lastSavedRef.current = value == null ? "" : String(value);
  }, [value]);

  useEffect(() => {
    if (registerInput) registerInput(athleteId, round, inputRef);
  }, [athleteId, round, registerInput]);

  const save = useCallback(
    async (raw) => {
      if (raw === "" || raw == null) return;
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > SCORE_MAX) {
        setErrored(true);
        toast.error(`Score for R${round} must be 0-${SCORE_MAX}`);
        return;
      }
      setSaving(true);
      setErrored(false);
      try {
        await api("/scores", {
          method: "POST",
          body: JSON.stringify({ athleteId, round, score: n }),
        });
        lastSavedRef.current = String(n);
        onSaved?.();
      } catch (e) {
        setErrored(true);
        toast.error(e.message || "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [athleteId, round, onSaved]
  );

  function onChange(e) {
    // Update the field only — do NOT save mid-typing. Saving on a debounce
    // timer was persisting partial values ("8" before "8.4" finished) and
    // flashing them back into the cell. We save on blur / Enter instead,
    // when the full value is entered.
    setVal(e.target.value);
  }

  function onBlur() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (val !== lastSavedRef.current) save(val);
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      onBlur();
      const next = document.querySelector(
        `input[data-rss-round="${round}"][data-rss-next-of="${athleteId}"]`
      );
      if (next && typeof next.focus === "function") next.focus();
    }
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={0}
      max={SCORE_MAX}
      step={0.1}
      inputMode="decimal"
      value={val}
      disabled={disabled}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      data-rss-round={round}
      data-rss-athlete={athleteId}
      className={[
        "h-9 w-16 rounded-md border bg-white px-2 text-center text-sm tabular focus:outline-none focus:ring-2 focus:ring-offset-1",
        disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : "",
        saving ? "border-amber-400 focus:ring-amber-300" : "border-slate-200 focus:ring-slate-300",
        errored ? "border-red-400 bg-red-50" : "",
      ].join(" ")}
    />
  );
}

// ---------- Score Grid ----------

function ScoreGrid({ state, onScoreSaved, onMutated }) {
  // Eliminate / reinstate toggle, available right in the scoring grid so the
  // judge never has to leave Score Entry. Refetches full state after (this is
  // an occasional action, not per-keystroke, so a refetch is fine here).
  async function toggleElim(a) {
    try {
      if (a.status === "eliminated") {
        await api(`/athletes/${a.id}/reinstate`, { method: "POST" });
        toast.success(`${a.fullName} reinstated`);
      } else {
        if (!confirm(`Eliminate ${a.fullName}? They keep their recorded scores but can no longer be scored (you can reinstate them).`)) return;
        await api(`/athletes/${a.id}/eliminate`, { method: "POST" });
        toast.success(`${a.fullName} eliminated`);
      }
      onMutated?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  // We expose a "next" pointer between athletes for Enter key navigation:
  // input[data-rss-next-of="<currentAthleteId>"] points to next athlete same round.
  const orderedAthletes = useMemo(
    () => [...state.athletes].sort((a, b) => a.competitorNumber - b.competitorNumber),
    [state.athletes]
  );
  // Pre-compute nextOf mapping
  const nextOfMap = useMemo(() => {
    const m = {};
    for (let i = 0; i < orderedAthletes.length; i++) {
      const cur = orderedAthletes[i];
      const next = orderedAthletes[i + 1];
      if (next) m[cur.id] = next.id;
    }
    return m;
  }, [orderedAthletes]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 py-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-slate-900">
              Score Entry · Series 1–{TOTAL_ROUNDS}
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Range 0.0 – {SCORE_MAX.toFixed(1)} · Autosaves on change · Enter moves to next shooter in same series
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[11px] uppercase tracking-wider">
            Round {state.currentRound} / {TOTAL_ROUNDS}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 w-10">#</th>
              <th className="px-3 py-2">Athlete</th>
              <th className="px-3 py-2 w-32">Country</th>
              {Array.from({ length: TOTAL_ROUNDS }, (_, i) => (
                <th key={i} className="px-2 py-2 text-center">
                  R{i + 1}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {orderedAthletes.map((a) => {
              const isElim = a.status === "eliminated";
              const nextOf = nextOfMap[a.id];
              return (
                <tr
                  key={a.id}
                  className={[
                    "border-t border-slate-100",
                    isElim ? "opacity-60 grayscale" : "",
                  ].join(" ")}
                >
                  <td className="px-3 py-2 tabular text-slate-500">
                    {String(a.competitorNumber).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleElim(a)}
                        title={isElim ? "Reinstate shooter" : "Eliminate shooter"}
                        className={
                          isElim
                            ? "h-7 w-7 shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            : "h-7 w-7 shrink-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                        }
                      >
                        {isElim ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                      </Button>
                      <span className="font-medium text-slate-900">{a.fullName}</span>
                      {isElim && (
                        <Badge variant="destructive" className="text-[10px] uppercase">
                          Eliminated R{a.eliminatedAfterRound}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{a.country || "—"}</td>
                  {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
                    const r = i + 1;
                    const v = a.rounds[r];
                    // For eliminated athletes, future rounds are locked out entirely
                    // and rendered as a dash, not an empty input. Past rounds keep
                    // the input (disabled) so the recorded score stays visible.
                    const isFutureForElim =
                      isElim &&
                      a.eliminatedAfterRound != null &&
                      r > a.eliminatedAfterRound;
                    return (
                      <td key={r} className="px-1 py-2 text-center">
                        {isFutureForElim ? (
                          <span
                            className="inline-flex h-9 w-16 items-center justify-center rounded-md bg-slate-100 text-xs font-medium uppercase tracking-wider text-slate-400"
                            title={`Eliminated after R${a.eliminatedAfterRound}`}
                            aria-label={`Locked — eliminated after round ${a.eliminatedAfterRound}`}
                          >
                            —
                          </span>
                        ) : (
                          <ScoreCellWrapper
                            athleteId={a.id}
                            round={r}
                            value={v}
                            disabled={isElim}
                            onSaved={onScoreSaved}
                            nextAthleteId={nextOf}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular font-semibold text-slate-900">
                    {a.total.toFixed(1)}
                  </td>
                </tr>
              );
            })}
            {orderedAthletes.length === 0 && (
              <tr>
                <td colSpan={TOTAL_ROUNDS + 4} className="px-3 py-8 text-center text-slate-500 text-sm">
                  No athletes registered. Switch to the Athletes tab to add them or load the sample roster.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const ScoreCellWrapper = memo(function ScoreCellWrapper({ athleteId, round, value, disabled, onSaved, nextAthleteId }) {
  // Attach a stable data attribute pointer for Enter-key navigation by querying
  // `input[data-rss-round=R][data-rss-next-of=athleteId]` for the next input.
  // We render two inputs would be wasteful, so just render one input then add
  // the data-rss-next-of attribute when the parent row of THIS input belongs to
  // the previous athlete. Simpler: render input with data-rss-next-of pointing
  // to ITS OWN previous-athlete-id. But we want to FIND next by current id.
  // Easier: render a hidden bookmark — just add nextAthleteId as data on this input,
  // and have ScoreCell find input where data-rss-athlete === nextAthleteId AND round === round.

  return <ScoreCellWithNav athleteId={athleteId} round={round} value={value} disabled={disabled} onSaved={onSaved} />;
});

function ScoreCellWithNav({ athleteId, round, value, disabled, onSaved }) {
  // Wraps ScoreCell but overrides Enter behavior to find next athlete in same round.
  const [val, setVal] = useState(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [errored, setErrored] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const lastSavedRef = useRef(value == null ? "" : String(value));

  useEffect(() => {
    // Never overwrite the field while the judge is editing it — the post-save
    // refetch would otherwise snap the value back (and jump the cursor),
    // making decimal entry impossible. Only sync from the server when this
    // cell is NOT focused.
    if (typeof document !== "undefined" && document.activeElement === inputRef.current) return;
    setVal(value == null ? "" : String(value));
    lastSavedRef.current = value == null ? "" : String(value);
  }, [value]);

  const save = useCallback(
    async (raw) => {
      if (raw === "" || raw == null) return;
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > SCORE_MAX) {
        setErrored(true);
        toast.error(`Score for R${round} must be 0-${SCORE_MAX}`);
        return;
      }
      setSaving(true);
      setErrored(false);
      try {
        await api("/scores", {
          method: "POST",
          body: JSON.stringify({ athleteId, round, score: n }),
        });
        lastSavedRef.current = String(n);
        onSaved?.(athleteId, round, n);
      } catch (e) {
        setErrored(true);
        toast.error(e.message || "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [athleteId, round, onSaved]
  );

  function onChange(e) {
    // Update the field only — do NOT save mid-typing. Saving on a debounce
    // timer was persisting partial values ("8" before "8.4" finished) and
    // flashing them back into the cell. We save on blur / Enter instead,
    // when the full value is entered.
    setVal(e.target.value);
  }

  function onBlur() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (val !== lastSavedRef.current) save(val);
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      onBlur();
      // Find next non-disabled input in the same round
      const all = document.querySelectorAll(`input[data-rss-round="${round}"]`);
      let found = false;
      for (const el of all) {
        if (found && !el.disabled) {
          el.focus();
          return;
        }
        if (el === inputRef.current) found = true;
      }
    }
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={0}
      max={SCORE_MAX}
      step={0.1}
      inputMode="decimal"
      value={val}
      disabled={disabled}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      data-rss-round={round}
      data-rss-athlete={athleteId}
      className={[
        "h-9 w-16 rounded-md border bg-white px-2 text-center text-sm tabular focus:outline-none focus:ring-2 focus:ring-offset-1",
        disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : "",
        saving ? "border-amber-400 focus:ring-amber-300" : "border-slate-200 focus:ring-slate-300",
        errored ? "border-red-400 bg-red-50" : "",
      ].join(" ")}
    />
  );
}

// ---------- Rankings ----------

function Rankings({ state }) {
  // Defense in depth: re-sort on the client too. The server already returns
  // athletes ordered by rank, but if it ever didn't, the UI still shows the
  // correct order (highest total first; ties broken by latest-round / prev /
  // higher competitor #, matching the server's compareForRank).
  function latestRound(x) {
    for (let r = TOTAL_ROUNDS; r >= 1; r--) if (x.rounds[r] != null) return r;
    return 0;
  }
  function cmp(a, b) {
    if (b.total !== a.total) return b.total - a.total;
    const maxR = Math.max(latestRound(a), latestRound(b));
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
  const active = state.athletes
    .filter((a) => a.status !== "eliminated")
    .slice()
    .sort(cmp);
  const eliminated = state.athletes
    .filter((a) => a.status === "eliminated")
    .slice()
    .sort((a, b) => {
      if ((b.eliminatedAfterRound ?? 0) !== (a.eliminatedAfterRound ?? 0)) {
        return (b.eliminatedAfterRound ?? 0) - (a.eliminatedAfterRound ?? 0);
      }
      return cmp(a, b);
    });

  function rankBadge(rank) {
    if (rank === 1) return <Badge className="bg-amber-500 text-white"><Crown className="h-3 w-3 mr-1" />1st</Badge>;
    if (rank === 2) return <Badge className="bg-slate-400 text-white"><Medal className="h-3 w-3 mr-1" />2nd</Badge>;
    if (rank === 3) return <Badge className="bg-orange-500 text-white"><Award className="h-3 w-3 mr-1" />3rd</Badge>;
    return <Badge variant="outline">{rank}</Badge>;
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 py-4">
        <CardTitle className="text-base font-semibold">Live Rankings</CardTitle>
        <CardDescription className="text-xs text-slate-500">
          Sorted by total points; ties broken by lower competitor number.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 w-20">Rank</th>
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Athlete</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{rankBadge(a.rank)}</td>
                <td className="px-3 py-2 tabular text-slate-500">
                  {String(a.competitorNumber).padStart(2, "0")}
                </td>
                <td className="px-3 py-2 font-medium text-slate-900">{a.fullName}</td>
                <td className="px-3 py-2 text-slate-600">{a.country || "—"}</td>
                <td className="px-3 py-2 text-right tabular font-semibold">{a.total.toFixed(1)}</td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No active athletes.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {eliminated.length > 0 && (
          <>
            <div className="px-3 py-2 bg-slate-50 border-t border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
              Eliminated
            </div>
            <table className="w-full text-sm">
              <tbody>
                {eliminated.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 opacity-70">
                    <td className="px-3 py-2 w-20 text-slate-500">#{a.rank}</td>
                    <td className="px-3 py-2 w-12 tabular text-slate-500">
                      {String(a.competitorNumber).padStart(2, "0")}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      <span className="line-through">{a.fullName}</span>
                      <Badge variant="destructive" className="ml-2 text-[10px] uppercase">
                        Out R{a.eliminatedAfterRound}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{a.country || "—"}</td>
                    <td className="px-3 py-2 text-right tabular">{a.total.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Athletes CRUD Panel ----------

function AthletesPanel({ state, onMutated }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ fullName: "", competitorNumber: "", country: "" });
  const [loading, setLoading] = useState(false);

  const ordered = useMemo(
    () => [...state.athletes].sort((a, b) => a.competitorNumber - b.competitorNumber),
    [state.athletes]
  );

  function openAdd() {
    const usedNums = new Set(state.athletes.map((a) => a.competitorNumber));
    let suggest = 1;
    while (usedNums.has(suggest) && suggest <= MAX_ATHLETES) suggest++;
    setEditing(null);
    setForm({ fullName: "", competitorNumber: String(suggest), country: "" });
    setOpen(true);
  }

  function openEdit(a) {
    setEditing(a);
    setForm({
      fullName: a.fullName,
      competitorNumber: String(a.competitorNumber),
      country: a.country || "",
    });
    setOpen(true);
  }

  async function submit() {
    setLoading(true);
    try {
      if (editing) {
        await api(`/athletes/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            fullName: form.fullName.trim(),
            competitorNumber: form.competitorNumber,
            country: form.country.trim(),
          }),
        });
        toast.success("Athlete updated");
      } else {
        await api("/athletes", {
          method: "POST",
          body: JSON.stringify({
            fullName: form.fullName.trim(),
            competitorNumber: form.competitorNumber,
            country: form.country.trim(),
          }),
        });
        toast.success("Athlete added");
      }
      setOpen(false);
      onMutated?.();
    } catch (e) {
      toast.error(e.message || "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function remove(a) {
    if (!confirm(`Delete ${a.fullName}? This removes all their scores too.`)) return;
    try {
      await api(`/athletes/${a.id}`, { method: "DELETE" });
      toast.success("Athlete removed");
      onMutated?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function eliminate(a) {
    if (!confirm(`Eliminate ${a.fullName}? They keep their recorded scores but can no longer be scored (you can reinstate them).`)) return;
    try {
      await api(`/athletes/${a.id}/eliminate`, { method: "POST" });
      toast.success(`${a.fullName} eliminated`);
      onMutated?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function reinstate(a) {
    try {
      await api(`/athletes/${a.id}/reinstate`, { method: "POST" });
      toast.success(`${a.fullName} reinstated`);
      onMutated?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function seed() {
    try {
      const r = await api("/seed", { method: "POST" });
      toast.success(r?.count ? `Added ${r.count} shooter(s)` : "Roster already loaded");
      onMutated?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 py-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Registered Athletes</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              {ordered.length} of {MAX_ATHLETES} registered.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {ordered.length < MAX_ATHLETES && (
              <Button size="sm" variant="outline" onClick={seed}>
                Load Roster
              </Button>
            )}
            <Button
              size="sm"
              onClick={openAdd}
              disabled={ordered.length >= MAX_ATHLETES}
              className="bg-[#0a2540] hover:bg-[#0a2540]/90"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Athlete
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Full Name</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2 tabular text-slate-500">
                  {String(a.competitorNumber).padStart(2, "0")}
                </td>
                <td className="px-3 py-2 font-medium">{a.fullName}</td>
                <td className="px-3 py-2 text-slate-600">{a.country || "—"}</td>
                <td className="px-3 py-2">
                  {a.status === "eliminated" ? (
                    <Badge variant="destructive" className="text-[10px] uppercase">
                      Eliminated R{a.eliminatedAfterRound}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="text-[10px] uppercase">
                      Active
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {a.status === "eliminated" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => reinstate(a)}
                        title="Reinstate shooter"
                        className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      >
                        <UserCheck className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => eliminate(a)}
                        title="Eliminate shooter"
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(a)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {ordered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500 text-sm">
                  No athletes registered. Add one or load the sample roster to begin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Athlete" : "Add Athlete"}</DialogTitle>
            <DialogDescription>
              Competitor numbers must be unique and in the range 1–{MAX_ATHLETES}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fn" className="text-xs uppercase tracking-wide text-slate-600">Full Name</Label>
              <Input
                id="fn"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cn" className="text-xs uppercase tracking-wide text-slate-600">Competitor #</Label>
                <Input
                  id="cn"
                  type="number"
                  min={1}
                  max={MAX_ATHLETES}
                  value={form.competitorNumber}
                  onChange={(e) => setForm((f) => ({ ...f, competitorNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co" className="text-xs uppercase tracking-wide text-slate-600">Country</Label>
                <Input
                  id="co"
                  value={form.country}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={loading || !form.fullName.trim()} className="bg-[#0a2540]">
              {loading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- Final Standings ----------

function FinalStandings({ state }) {
  // Podium = sort all athletes by their final ranking and take top 3.
  // Active finalists rank above eliminated; among eliminated, most-recently-out
  // ranks above earlier-out. The server already returns this order in `rank`.
  const podium = [...state.athletes].sort((a, b) => a.rank - b.rank).slice(0, 3);
  const ready = state.currentRound >= TOTAL_ROUNDS;
  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 py-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Final Standings
        </CardTitle>
        <CardDescription className="text-xs text-slate-500">
          {ready
            ? "Competition complete — Gold, Silver, Bronze."
            : `Final podium locks after round ${TOTAL_ROUNDS}. Currently round ${state.currentRound} / ${TOTAL_ROUNDS}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        {podium.length < 3 ? (
          <p className="text-sm text-slate-500">
            Podium populates once at least 3 shooters are registered. Currently {podium.length} ranked.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PodiumCard rank={1} athlete={podium[0]} />
            <PodiumCard rank={2} athlete={podium[1]} />
            <PodiumCard rank={3} athlete={podium[2]} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PodiumCard({ rank, athlete }) {
  const styles =
    rank === 1
      ? { bg: "bg-gradient-to-br from-amber-50 to-amber-100", border: "border-amber-300", chip: "bg-amber-500", label: "Gold · 1st Place", icon: <Crown className="h-5 w-5" /> }
      : rank === 2
      ? { bg: "bg-gradient-to-br from-slate-50 to-slate-100", border: "border-slate-300", chip: "bg-slate-400", label: "Silver · 2nd Place", icon: <Medal className="h-5 w-5" /> }
      : { bg: "bg-gradient-to-br from-orange-50 to-orange-100", border: "border-orange-300", chip: "bg-orange-500", label: "Bronze · 3rd Place", icon: <Award className="h-5 w-5" /> };
  return (
    <div className={`rounded-lg border-2 p-5 ${styles.bg} ${styles.border}`}>
      <div className={`inline-flex items-center gap-1.5 text-white text-xs font-semibold uppercase tracking-wide rounded-full px-3 py-1 ${styles.chip}`}>
        {styles.icon}
        {styles.label}
      </div>
      <div className="mt-4 text-2xl font-semibold text-slate-900">{athlete.fullName}</div>
      <div className="text-sm text-slate-600 mt-1">
        Competitor #{String(athlete.competitorNumber).padStart(2, "0")} · {athlete.country || "—"}
      </div>
      <div className="mt-3 text-3xl font-bold tabular text-slate-900">
        {athlete.total.toFixed(1)} <span className="text-sm font-normal text-slate-500">pts</span>
      </div>
    </div>
  );
}

// ---------- Competition History ----------

function HistoryPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/competitions");
      setItems(data.items || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function viewItem(id) {
    try {
      const data = await api(`/competitions/${id}`);
      setSelected(data);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function deleteItem(id) {
    if (!confirm("Permanently delete this archived competition?")) return;
    try {
      await api(`/competitions/${id}`, { method: "DELETE" });
      toast.success("Archive deleted");
      load();
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 py-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          Competition History
        </CardTitle>
        <CardDescription className="text-xs text-slate-500">
          Past competitions are automatically archived when you Reset the active event.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 w-44">Archived</th>
              <th className="px-3 py-2 w-24 text-center">Rounds</th>
              <th className="px-3 py-2 w-24 text-center">Athletes</th>
              <th className="px-3 py-2 w-32 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No archived competitions yet.</td></tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-slate-600 tabular">{new Date(c.archivedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-center tabular">{c.currentRound}/{TOTAL_ROUNDS}</td>
                  <td className="px-3 py-2 text-center tabular">{c.athletes?.length ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => viewItem(c.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteItem(c.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              Archived {selected ? new Date(selected.archivedAt).toLocaleString() : ""} · Round {selected?.currentRound}/{TOTAL_ROUNDS}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 w-14">Rank</th>
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">Athlete</th>
                  <th className="px-3 py-2">Country</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {selected?.athletes?.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular">{a.rank}</td>
                    <td className="px-3 py-2 tabular text-slate-500">{String(a.competitorNumber).padStart(2, "0")}</td>
                    <td className="px-3 py-2 font-medium">{a.fullName}</td>
                    <td className="px-3 py-2 text-slate-600">{a.country || "—"}</td>
                    <td className="px-3 py-2 text-right tabular font-semibold">{a.total.toFixed(1)}</td>
                    <td className="px-3 py-2">
                      {a.status === "eliminated" ? (
                        <Badge variant="destructive" className="text-[10px] uppercase">Out R{a.eliminatedAfterRound}</Badge>
                      ) : (
                        <Badge variant="success" className="text-[10px] uppercase">Active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- Main App ----------

function App({ user, onLogout }) {
  const [state, setState] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("scores");

  const fetchState = useCallback(async () => {
    try {
      const s = await api("/state");
      setState(s);
    } catch (e) {
      if (e.message === "Unauthorized") onLogout();
      else toast.error(e.message);
    }
  }, [onLogout]);

  useEffect(() => { fetchState(); }, [fetchState]);

  // No background polling — it was overwriting cells mid-edit and causing
  // flicker. State refreshes only on deliberate actions: after a score saves
  // (onScoreSaved) and when switching to a read tab (handleTabChange).

  // Apply a saved score to local state instead of refetching the whole
  // competition. The old refetch replaced the entire state object on every
  // keystroke-save, re-rendering all 192 cells — that full-grid repaint is
  // what looked like a page "reload" when you pressed Enter. Authoritative
  // ranks / current round still refresh when you switch to a read tab.
  const onScoreSaved = useCallback((athleteId, round, score) => {
    setState((prev) => {
      if (!prev) return prev;
      const athletes = prev.athletes.map((a) => {
        if (a.id !== athleteId) return a;
        const rounds = { ...a.rounds, [round]: score };
        let total = 0;
        for (const k in rounds) {
          const v = rounds[k];
          if (typeof v === "number") total += v;
        }
        return { ...a, rounds, total: Math.round(total * 10) / 10 };
      });
      return { ...prev, athletes };
    });
  }, []);

  // Instant refresh whenever the user switches to a read-mostly tab.
  const handleTabChange = useCallback((v) => {
    setTab(v);
    if (v === "rankings" || v === "final" || v === "history") fetchState();
  }, [fetchState]);

  async function advance() {
    try {
      const s = await api("/rounds/advance", { method: "POST" });
      setState(s);
      toast.success(`Advanced to round ${s.currentRound}`);
    } catch (e) {
      if (e.payload?.missing?.length) {
        const names = e.payload.missing.map((m) => m.name).join(", ");
        toast.error(`Missing scores: ${names}`);
      } else {
        toast.error(e.message);
      }
    }
  }

  async function setRound(r) {
    try {
      const s = await api("/rounds/set", { method: "POST", body: JSON.stringify({ round: r }) });
      setState(s);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function reset() {
    if (!confirm("Reset the entire competition? Current results will be archived to History.")) return;
    const name = window.prompt("Name for the archive (optional):", `Competition ${new Date().toISOString().slice(0, 10)}`);
    try {
      await api("/reset", { method: "POST", body: JSON.stringify({ name: name || undefined }) });
      toast.success("Competition archived and reset");
      await fetchState();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function exportFile(format) {
    try {
      const token = getToken();
      const res = await fetch(`/api/export/${format}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `competition-results-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} exported`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  const leader = state.athletes.find((a) => a.status !== "eliminated");
  const activeCount = state.athletes.filter((a) => a.status !== "eliminated").length;
  const elimCount = state.athletes.filter((a) => a.status === "eliminated").length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="bg-[#0a2540] text-white">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded bg-white/10 flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide">Rapid Stage Scoring System</div>
              <div className="text-[11px] text-white/60 uppercase tracking-wider">Officiating · Internal</div>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-300" />
              Round <span className="font-mono">{state.currentRound}</span>/{TOTAL_ROUNDS}
            </div>
            <Separator orientation="vertical" className="h-4 bg-white/20" />
            <div>Active: <span className="font-mono">{activeCount}</span></div>
            <div>Eliminated: <span className="font-mono">{elimCount}</span></div>
            <Separator orientation="vertical" className="h-4 bg-white/20" />
            <span className="text-white/70">{user?.username}</span>
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-white hover:bg-white/10 h-8">
              <LogOut className="h-3.5 w-3.5 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 py-5 space-y-5">
        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Registered"
            value={`${state.athletes.length} / ${MAX_ATHLETES}`}
          />
          <StatCard
            icon={<Activity className="h-4 w-4 text-emerald-600" />}
            label="Active"
            value={activeCount}
          />
          <StatCard
            icon={<ChevronRight className="h-4 w-4" />}
            label="Current Round"
            value={`R${state.currentRound} of ${TOTAL_ROUNDS}`}
          />
          <StatCard
            icon={<Trophy className="h-4 w-4 text-amber-500" />}
            label="Leader"
            value={leader ? `${leader.fullName} · ${leader.total.toFixed(1)} pts` : "—"}
            small
          />
        </div>

        {/* Round control bar */}
        <Card className="border-slate-200">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 mr-2">Jump to series:</span>
                {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
                  const r = i + 1;
                  const active = state.currentRound === r;
                  return (
                    <button
                      key={r}
                      onClick={() => setRound(r)}
                      className={[
                        "h-8 min-w-[36px] px-2 rounded-md border text-xs font-medium tabular transition-colors",
                        active
                          ? "bg-[#0a2540] text-white border-[#0a2540]"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      R{r}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-md border border-slate-200 overflow-hidden">
                  <button
                    onClick={() => exportFile("csv")}
                    className="h-9 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 border-r border-slate-200 inline-flex items-center"
                    title="Export as CSV"
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    CSV
                  </button>
                  <button
                    onClick={() => exportFile("xlsx")}
                    className="h-9 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 border-r border-slate-200"
                    title="Export as Excel"
                  >
                    XLSX
                  </button>
                  <button
                    onClick={() => exportFile("pdf")}
                    className="h-9 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title="Export as PDF"
                  >
                    PDF
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={advance}
                  disabled={state.currentRound >= TOTAL_ROUNDS || state.athletes.length === 0}
                  className="bg-[#0a2540] hover:bg-[#0a2540]/90"
                >
                  <Lock className="h-4 w-4 mr-1" />
                  Lock & Advance
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={reset}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
              </div>
            </div>
            {refreshing && (
              <div className="mt-2 text-[11px] text-slate-400">Refreshing rankings…</div>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-3">
          <TabsList>
            <TabsTrigger value="scores">Score Entry</TabsTrigger>
            <TabsTrigger value="rankings">Rankings</TabsTrigger>
            <TabsTrigger value="athletes">Athletes</TabsTrigger>
            <TabsTrigger value="final">Final Standings</TabsTrigger>
            <TabsTrigger value="history">
              <Archive className="h-3.5 w-3.5 mr-1" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scores">
            <ScoreGrid state={state} onScoreSaved={onScoreSaved} onMutated={fetchState} />
          </TabsContent>
          <TabsContent value="rankings">
            <Rankings state={state} />
          </TabsContent>
          <TabsContent value="athletes">
            <AthletesPanel state={state} onMutated={fetchState} />
          </TabsContent>
          <TabsContent value="final">
            <FinalStandings state={state} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1600px] mx-auto px-6 py-3 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Rapid Stage Scoring System · Internal Officiating Platform</span>
          <span>v1.0 · {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ icon, label, value, small }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
          {icon}
          {label}
        </div>
        <div className={small ? "mt-1 text-sm font-semibold text-slate-900 truncate" : "mt-1 text-2xl font-semibold text-slate-900 tabular"}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Root Component ----------

export default function Page() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    async function verify() {
      const t = getToken();
      if (!t) {
        if (alive) setChecking(false);
        return;
      }
      try {
        await api("/auth/verify");
        if (alive) setUser({ username: "admin" });
      } catch {
        if (alive) setUser(null);
      } finally {
        if (alive) setChecking(false);
      }
    }
    verify();
    return () => { alive = false; };
  }, []);

  function logout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) return <LoginScreen onLoggedIn={setUser} />;
  return <App user={user} onLogout={logout} />;
}
