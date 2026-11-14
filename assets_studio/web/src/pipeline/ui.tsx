// Small shared pieces of the pipeline UI.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { Job } from "../api/client";
import { jobs as allJobs } from "../state/store";
import type { Status } from "./steps";

export const STATUS_TEXT: Record<Status, string> = {
  off: "Skipped",
  running: "Working",
  failed: "Failed",
  stale: "Needs update",
  done: "Done",
  ready: "Ready to run",
  blocked: "Waiting for earlier step",
  nomodel: "Model not set up",
  review: "Video to review",
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span class={`chip chip-${status}`}>
      {status === "running" && <span class="pulse" aria-hidden="true" />}
      {STATUS_TEXT[status]}
    </span>
  );
}

export const JOB_TEXT: Record<string, string> = {
  queued: "Queued",
  waiting_model: "Waiting its turn",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Seconds since an ISO time, refreshed every second while shown. */
export function useElapsed(since: string | undefined, live: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  if (!since) return 0;
  return Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000));
}

export function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Tasks you work in by hand (an editor window): no time estimate, the bar just shows it is open. */
const INTERACTIVE = new Set(["3d-texture-repair"]);

/** "about 2 min", "about 30 s", "about 1 h" -> seconds (the step's own guess, used until there is history). */
function parseTypical(typical?: string): number | undefined {
  const match = typical?.match(/(\d+(?:\.\d+)?)\s*(s|sec|min|h)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  return unit.startsWith("h") ? value * 3600 : unit === "min" ? value * 60 : value;
}

/** Jobs of one task can be very different runs: the motion step can animate a reviewed clip (minutes), make a video
 * only (about 10 min) or do everything (video, fit, export). Only like is compared with like. */
function runKind(job: Job): string {
  const params = (job.params ?? {}) as Record<string, unknown>;
  if (job.task === "ai-video-motion") {
    if (params.use_clip) return "animate-clip";
    if (params.review_video) return "video-only";
    return "full";
  }
  return "";
}

/** Measured on this PC (WORKFLOW 2b, 9000 steps): the reader trains 17-23 min once per creature. */
const READER_TRAINING_S = 20 * 60;
/** A full motion run is at least a video plus fit and export, whatever quick resumes the history holds. */
const MIN_FULL_MOTION_S = 12 * 60;

function seconds(job: Job): number | undefined {
  const timing = job.timing as { generate_s?: number } | null | undefined;
  if (typeof timing?.generate_s === "number") return timing.generate_s;
  if (job.started_at && job.finished_at) return (Date.parse(job.finished_at) - Date.parse(job.started_at)) / 1000;
  return undefined;
}

/** How long a job of this model and task (and kind of run) usually takes: the median of its last finished runs (up
 * to 8), else the step's typical time. A motion run on a rig that never had one adds the reader's training.
 * Undefined when there is nothing to go on, or for interactive tasks. */
export function estimateSeconds(job: Job, typical?: string): number | undefined {
  if (INTERACTIVE.has(job.task)) return undefined;
  const kind = runKind(job);
  const past: number[] = [];
  let rigSeen = false;
  const rig = (job.inputs as Record<string, string | undefined>).rig;
  for (const other of allJobs.value.values()) {
    if (other.id === job.id || other.server !== job.server || other.task !== job.task) continue;
    if (rig && (other.inputs as Record<string, string | undefined>).rig === rig && other.status === "succeeded"
        && Date.parse(other.created_at) < Date.parse(job.created_at))
      rigSeen = true;
    if (other.status !== "succeeded" || runKind(other) !== kind) continue;
    const value = seconds(other);
    // under a minute is a reuse (an earlier clip offered again, a resumed export), not a run like this one
    if (value !== undefined && value >= 60) past.push(value);
  }
  let estimate: number | undefined;
  if (past.length) {
    const recent = past.slice(-8).sort((a, b) => a - b);
    estimate = recent[Math.floor(recent.length / 2)];
  } else {
    estimate = parseTypical(typical);
  }
  if (estimate === undefined) return undefined;
  if (job.task === "ai-video-motion") {
    if (kind === "full") estimate = Math.max(estimate, MIN_FULL_MOTION_S);
    if (kind !== "animate-clip" && !rigSeen) estimate += READER_TRAINING_S;
  }
  return estimate;
}

export interface Progress {
  /** queued / waiting / running / interactive */
  phase: "queued" | "waiting" | "after" | "running" | "open";
  /** 0..1 while running with an estimate */
  fraction?: number | undefined;
  elapsed: number;
  left?: number | undefined;
  over: boolean;
  estimate?: number | undefined;
}

/** Live progress of a pending job, refreshed every second. */
export function useProgress(job: Job, typical?: string): Progress {
  const running = job.status === "running";
  const since = running ? (job.started_at ?? job.created_at) : job.created_at;
  const elapsed = useElapsed(since, true);
  if (job.status === "queued" && Object.keys(job.dependencies).length > 0) return { phase: "after", elapsed, over: false };
  if (job.status === "queued") return { phase: "queued", elapsed, over: false };
  if (job.status === "waiting_model") return { phase: "waiting", elapsed, over: false };
  if (INTERACTIVE.has(job.task)) return { phase: "open", elapsed, over: false };
  const estimate = estimateSeconds(job, typical);
  if (!estimate) return { phase: "running", elapsed, over: false };
  // eases toward the end instead of sitting at 100 %: past the estimate it creeps from 95 % to 99 %
  const raw = elapsed / estimate;
  const over = raw > 1;
  const fraction = over ? Math.min(0.99, 0.95 + 0.04 * (1 - Math.exp(-(raw - 1) * 2))) : Math.min(0.95, raw * 0.95);
  return { phase: "running", fraction, elapsed, left: over ? undefined : Math.max(0, estimate - elapsed), over, estimate };
}

export function progressLabel(progress: Progress): string {
  switch (progress.phase) {
    case "after":
      return "Starts after the step before";
    case "queued":
      return "Queued";
    case "waiting":
      return "Waiting its turn";
    case "open":
      return "Open in the editor";
    default:
      if (progress.fraction === undefined) return "Working";
      return progress.over ? "Almost there" : `${Math.round(progress.fraction * 100)} %`;
  }
}

/** The bar itself: determinate with an estimate, striped while waiting, a moving sheen while working without one. */
export function ProgressBar({ progress, small = false }: { progress: Progress; small?: boolean }) {
  const kind =
    progress.phase === "running" && progress.fraction !== undefined
      ? progress.over ? "over" : "fill"
      : progress.phase === "running" || progress.phase === "open" ? "indeterminate" : "waiting";
  return (
    <span
      class={`pbar is-${kind}${small ? " pbar-small" : ""}`}
      role="progressbar"
      aria-label={progressLabel(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.fraction !== undefined ? Math.round(progress.fraction * 100) : undefined}
    >
      <span class="pbar-fill" style={kind === "fill" || kind === "over" ? { width: `${(progress.fraction ?? 0) * 100}%` } : undefined} />
    </span>
  );
}

export function JobProgress({ job, typical }: { job: Job; typical?: string }) {
  const progress = useProgress(job, typical);
  return (
    <span class="progress-text">
      <ProgressBar progress={progress} />
      <b>{progressLabel(progress)}</b>
      {progress.left !== undefined && <span class="muted"> · about {clock(Math.round(progress.left))} left</span>}
      {progress.over && progress.estimate && (
        <span class="muted"> · taking longer than the usual {clock(Math.round(progress.estimate))}</span>
      )}
      <span class="muted"> · {clock(progress.elapsed)}</span>
      {progress.fraction === undefined && typical && progress.phase === "running" && (
        <span class="muted"> · usually {typical}</span>
      )}
      {progress.phase === "waiting" && <span class="muted"> · heavy models run one at a time</span>}
    </span>
  );
}

/** The step header's chip while a job runs: a small bar with the percentage instead of "Working". */
export function RunningChip({ job, typical }: { job: Job; typical?: string }) {
  const progress = useProgress(job, typical);
  return (
    <span class="chip chip-running chip-progress" title={progressLabel(progress)}>
      <ProgressBar progress={progress} small />
      {progressLabel(progress)}
    </span>
  );
}

export function Dot({ state }: { state: string }) {
  return <span class={`dot dot-${state}`} title={state} aria-label={state} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>("input, textarea, select, button.primary")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div class={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <header>
          <h2>{title}</h2>
          <button class="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** A button that asks once more on itself before acting. */
export function ConfirmButton({
  label,
  confirm,
  onConfirm,
  class: className = "",
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  class?: string;
}) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <button class={`button danger ${className}`} onBlur={() => setAsking(false)} onClick={onConfirm} autoFocus>
      {confirm}
    </button>
  ) : (
    <button class={`button ${className}`} onClick={() => setAsking(true)}>
      {label}
    </button>
  );
}

export const plural = (count: number, one: string, many = one + "s") => `${count} ${count === 1 ? one : many}`;
