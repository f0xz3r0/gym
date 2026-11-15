// The Performance column: live RAM, commit memory, GPU and CPU, the biggest programs, and whether a heavy job can
// start now. Data: GET /api/system/stats (a cached snapshot the server samples every 2 s; system_stats.py).
// Shown on the left of every page; when hidden, a one-line summary sits in the top bar.
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";

import { servers } from "../state/store";

interface Point { t: number; ram: number; commit: number | null; vram: number | null }
interface Proc { name: string; studio: boolean; count: number; ram: number; commit: number; vram: number }
type Level = "good" | "ok" | "warn" | "busy" | "bad";
export interface Stats {
  ok: boolean;
  at: number;
  interval: number;
  ram: { total: number; used: number; available: number };
  commit: { used: number; limit: number; available: number } | null;
  gpu: { name: string; util: number | null; temp: number | null; vram_used: number | null; vram_total: number | null } | null;
  locks: { heavy: boolean | null; gpu: boolean | null };
  cpu: { percent: number; cores: number };
  processes: Proc[];
  verdict: { level: Level; text: string };
  thresholds: { commit_guard: number; commit_warn: number; video_ram: number };
  monitor: { cpu_percent_of_one_core: number; last_sample_ms: number };
  history: Point[];
}

const GiB = 2 ** 30;
const WINDOW = 300; // seconds shown in the small charts
const KEY = "assets-studio.performance-open";
const gb = (bytes: number, digits = 1) => (bytes / GiB).toFixed(digits);

export const stats = signal<Stats | null>(null);
const failed = signal(false);

function rememberedOpen(): boolean {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "1" || value === "0") return value === "1";
  } catch {
    // storage blocked: fall through to the default
  }
  return window.matchMedia("(min-width: 900px)").matches;
}
export const perfOpen = signal(rememberedOpen());
export function setPerfOpen(open: boolean) {
  perfOpen.value = open;
  try {
    localStorage.setItem(KEY, open ? "1" : "0");
  } catch {
    // not remembered; fine
  }
}

/** Poll every 2 s while this tab is visible. */
export function usePerformancePolling() {
  useEffect(() => {
    let timer: number | undefined;
    const life = { stopped: false, busy: false };
    const alive = () => !life.stopped && !document.hidden;
    const tick = async () => {
      timer = undefined;
      if (!alive() || life.busy) return;
      life.busy = true;
      try {
        const response = await fetch("/api/system/stats");
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as Stats;
        if (data.ok) stats.value = data;
        failed.value = false;
      } catch {
        failed.value = true;
      }
      life.busy = false;
      if (alive()) timer = window.setTimeout(tick, 2000);
    };
    const onVisible = () => {
      if (!document.hidden && timer === undefined) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      life.stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

function commitLevel(s: Stats): "good" | "warn" | "bad" {
  if (!s.commit) return "good";
  if (s.commit.available < s.thresholds.commit_guard) return "bad";
  return s.commit.available < s.thresholds.commit_warn ? "warn" : "good";
}

const ICON: Record<Level, string> = { good: "✓", ok: "✓", warn: "!", busy: "◷", bad: "✕" };

// ------------------------------------------------------------------ top bar summary (when the column is hidden)

export function PerfSummary() {
  const s = stats.value;
  if (perfOpen.value) return null;
  const level = s ? s.verdict.level : "busy";
  return (
    <button
      type="button"
      class={`perf-summary is-${level}`}
      onClick={() => setPerfOpen(true)}
      title={s ? `${s.verdict.text} Click to show the Performance column.` : "Show the Performance column"}
    >
      <span class="perf-icon" aria-hidden="true">{s ? ICON[level] : "…"}</span>
      {s ? (
        <>
          {s.commit && <span>Commit <b>{gb(s.commit.available)} GB</b> free</span>}
          <span class="perf-summary-more">RAM <b>{gb(s.ram.used)}</b>/{gb(s.ram.total, 0)}</span>
          {s.gpu?.vram_used != null && s.gpu.vram_total != null && (
            <span class="perf-summary-more">VRAM <b>{gb(s.gpu.vram_used)}</b>/{gb(s.gpu.vram_total, 0)}</span>
          )}
        </>
      ) : (
        <span>Performance</span>
      )}
    </button>
  );
}

// ------------------------------------------------------------------ the column

function Meter({ fraction, level, marker, label }: { fraction: number; level: string; marker?: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <span class={`perf-meter is-${level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}>
      <span class="perf-meter-fill" style={{ width: `${clamped * 100}%` }} />
      {marker !== undefined && <span class="perf-meter-mark" style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} />}
    </span>
  );
}

/** A small single-series line of the last 5 minutes, 0..max, with an optional guard line and a hover readout. */
function Spark({ points, pick, max, guard, label }: {
  points: Point[]; pick: (p: Point) => number | null; max: number; guard?: number; label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 240, H = 34;
  const now = points.at(-1)?.t ?? 0;
  const x = (t: number) => W - ((now - t) / WINDOW) * W;
  const y = (v: number) => H - 1 - (Math.min(v, max) / max) * (H - 2);
  const usable = points.filter((p) => pick(p) !== null && now - p.t <= WINDOW);
  const path = usable.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(pick(p) as number).toFixed(1)}`).join(" ");
  const onMove = (event: PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !usable.length) return;
    const t = now - (1 - (event.clientX - box.left) / box.width) * WINDOW;
    let best = 0;
    let gap = Infinity;
    usable.forEach((p, i) => {
      if (Math.abs(p.t - t) < gap) { gap = Math.abs(p.t - t); best = i; }
    });
    setHover(best);
  };
  const point = hover !== null ? usable[hover] : undefined;
  const span = Math.round(now - (usable[0]?.t ?? now));
  return (
    <div class="perf-spark">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`${label}, last ${Math.max(1, Math.round(span / 60))} min`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {guard !== undefined && <line class="perf-spark-guard" x1={0} x2={W} y1={y(guard)} y2={y(guard)} />}
        <path class="perf-spark-line" d={path} />
        {point && (
          <>
            <line class="perf-spark-cross" x1={x(point.t)} x2={x(point.t)} y1={0} y2={H} />
            <circle class="perf-spark-dot" cx={x(point.t)} cy={y(pick(point) as number)} r={3} />
          </>
        )}
      </svg>
      <span class="perf-spark-caption">
        {point ? (
          <><b>{gb(pick(point) as number)} GB</b> · {Math.round(now - point.t)} s ago</>
        ) : (
          <>last {span >= 60 ? `${Math.round(span / 60)} min` : `${span} s`}</>
        )}
      </span>
    </div>
  );
}

function gpuHolder(s: Stats): string {
  if (!s.locks.gpu && !s.locks.heavy) return s.locks.gpu === null ? "unknown" : "free";
  const busy = servers.value.filter((server) => server.state === "busy").map((server) => server.title.split(" · ")[0]);
  return busy.length ? `in use: ${busy.join(", ")}` : "in use by a heavy job";
}

export function PerformanceColumn() {
  const s = stats.value;
  if (!perfOpen.value) return null;
  return (
    <aside class="perf" aria-label="Performance">
      <div class="perf-head">
        <span class="perf-title">Performance</span>
        <button type="button" class="icon-button" title="Hide the Performance column" aria-label="Hide the Performance column"
          onClick={() => setPerfOpen(false)}>«</button>
      </div>
      {!s ? (
        <p class="muted small">{failed.value ? "No readings: is the studio running?" : "Reading…"}</p>
      ) : (
        <PerfBody s={s} />
      )}
    </aside>
  );
}

function PerfBody({ s }: { s: Stats }) {
  const guard = s.thresholds.commit_guard;
  const level = commitLevel(s);
  const stale = Date.now() / 1000 - s.at > 10 || failed.value;
  return (
    <>
      <div class={`perf-verdict is-${s.verdict.level}`}>
        <span class="perf-icon" aria-hidden="true">{ICON[s.verdict.level]}</span>
        <span>{s.verdict.text}</span>
      </div>

      {s.commit && (
        <section class="perf-tile">
          <div class="perf-label" title="Windows commit memory (RAM + page file) still free. This is the real limit: heavy jobs are stopped when it falls under the guard line.">
            Commit memory free
          </div>
          <div class="perf-value">
            <b>{gb(s.commit.available)} GB</b> <span class="muted">of {gb(s.commit.limit, 0)} GB</span>
          </div>
          <Meter fraction={s.commit.available / s.commit.limit} level={level} marker={guard / s.commit.limit}
            label="Commit memory free" />
          <div class="perf-note muted" title="The guard is set to 4 billion bytes, which Windows shows as 3.7 GB.">
            Guard line {gb(guard)} GB: heavy jobs stop below it.
          </div>
          <Spark points={s.history} pick={(p) => p.commit} max={s.commit.limit} guard={guard} label="Commit memory free" />
        </section>
      )}

      <section class="perf-tile">
        <div class="perf-label">RAM used</div>
        <div class="perf-value">
          <b>{gb(s.ram.used)} GB</b> <span class="muted">of {gb(s.ram.total)} GB · {gb(s.ram.available)} GB free</span>
        </div>
        <Meter fraction={s.ram.used / s.ram.total} level={s.ram.available < 2 * GiB ? "bad" : s.ram.available < 4 * GiB ? "warn" : "accent"}
          label="RAM used" />
        <Spark points={s.history} pick={(p) => p.ram} max={s.ram.total} label="RAM used" />
      </section>

      {s.gpu && (
        <section class="perf-tile">
          <div class="perf-label" title={s.gpu.name}>GPU memory (VRAM)</div>
          {s.gpu.vram_used != null && s.gpu.vram_total != null && (
            <>
              <div class="perf-value">
                <b>{gb(s.gpu.vram_used)} GB</b> <span class="muted">of {gb(s.gpu.vram_total)} GB</span>
              </div>
              <Meter fraction={s.gpu.vram_used / s.gpu.vram_total} level="accent" label="VRAM used" />
              <Spark points={s.history} pick={(p) => p.vram} max={s.gpu.vram_total} label="VRAM used" />
            </>
          )}
          <div class="perf-facts">
            <span>Load <b>{s.gpu.util ?? "?"}%</b></span>
            <span><b>{s.gpu.temp != null ? Math.round(s.gpu.temp) : "?"} °C</b></span>
          </div>
          <div class="perf-facts" title="One heavy GPU job at a time (the studio's heavy-job slot and GPU lease).">
            <span>Heavy-job slot: <b>{gpuHolder(s)}</b></span>
          </div>
        </section>
      )}

      <section class="perf-tile perf-cpu">
        <div class="perf-label">CPU</div>
        <Meter fraction={s.cpu.percent / 100} level="accent" label="CPU load" />
        <b class="perf-cpu-value">{Math.round(s.cpu.percent)}%</b>
      </section>

      <section class="perf-tile">
        <div class="perf-label" title="Programs grouped by name. RAM = memory in use (as in Task Manager); commit = memory promised to it, which counts against the commit limit.">
          Biggest programs
        </div>
        <table class="perf-procs">
          <thead>
            <tr><th scope="col">Program</th><th scope="col">RAM</th><th scope="col">Commit</th></tr>
          </thead>
          <tbody>
            {s.processes.slice(0, 6).map((p) => (
              <tr key={p.name} class={p.studio ? "is-studio" : ""}
                title={`${p.name}${p.count > 1 ? ` (${p.count} processes)` : ""}${p.studio ? ", a studio service" : ""}`}>
                <td>
                  <span class="perf-proc-name">{p.studio && <span class="perf-studio-mark" aria-label="studio service">◆</span>}{p.name}</span>
                  {p.vram >= 0.1 * GiB && <span class="perf-proc-vram">VRAM {gb(p.vram)} GB</span>}
                </td>
                <td>{gb(p.ram)}</td>
                <td>{gb(p.commit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="perf-note muted">GB · ◆ = studio service</div>
      </section>

      <p class="perf-foot muted">
        {stale ? "Readings are old: is the studio running?" : `Live, every ${s.interval} s.`} The readout itself uses
        about {s.monitor.cpu_percent_of_one_core.toFixed(1)}% of one CPU core.
      </p>
    </>
  );
}
