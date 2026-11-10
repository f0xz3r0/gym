// Small shared pieces of the pipeline UI.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { Job } from "../api/client";
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

export function JobProgress({ job, typical }: { job: Job; typical?: string }) {
  const seconds = useElapsed(job.created_at, true);
  const waiting = job.status === "waiting_model" || job.status === "queued";
  const afterPrevious = job.status === "queued" && Object.keys(job.dependencies).length > 0;
  return (
    <span class="progress-text">
      <span class={`bar${waiting ? " waiting" : ""}`} aria-hidden="true" />
      {afterPrevious ? "Starts after the step before" : (JOB_TEXT[job.status] ?? job.status)} · {clock(seconds)}
      {typical && <span class="muted"> · usually {typical}</span>}
      {job.status === "waiting_model" && <span class="muted"> · heavy models run one at a time</span>}
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
