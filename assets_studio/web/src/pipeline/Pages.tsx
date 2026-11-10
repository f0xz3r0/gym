// Queue (what is running and waiting) and Models (which model servers are up).
import type { Job } from "../api/client";
import { taskLabel } from "../format";
import { jobs, servers } from "../state/store";
import { act, cancelJob, docs } from "./state";
import { PENDING, stepById } from "./steps";
import { clock, Dot, JOB_TEXT, useElapsed } from "./ui";

/** Which game asset and step a job belongs to, if any. */
function owners() {
  const map = new Map<string, { doc: string; name: string; step: string }>();
  for (const doc of docs.value.values())
    for (const [stepId, state] of Object.entries(doc.steps))
      for (const id of state.jobs ?? [])
        map.set(id, {
          doc: doc.id,
          name: doc.name,
          step: stepId === "prompt" ? "Description" : (stepById(stepId)?.title ?? stepId),
        });
  return map;
}

function JobRow({ job, owner }: { job: Job; owner: { doc: string; name: string; step: string } | undefined }) {
  const live = PENDING.has(job.status);
  const seconds = useElapsed(job.created_at, live);
  const server = servers.value.find((item) => item.id === job.server);
  return (
    <tr class={`job-${job.status}`}>
      <td>
        {owner ? (
          <a href={`#/a/${owner.doc}`}>
            <b>{owner.name}</b> · {owner.step}
          </a>
        ) : (
          <span>{taskLabel(job.task)}</span>
        )}
        <div class="muted small">{server?.title ?? job.server}</div>
      </td>
      <td>
        <span class={`chip job-chip-${job.status}`}>{JOB_TEXT[job.status] ?? job.status}</span>
        {job.status === "failed" && job.error_message && <div class="small error-text">{job.error_message}</div>}
      </td>
      <td class="muted">{live ? clock(seconds) : new Date(job.created_at).toLocaleString()}</td>
      <td>
        {live && (
          <button class="button small ghost" onClick={() => void act(() => cancelJob(job))}>
            Cancel
          </button>
        )}
      </td>
    </tr>
  );
}

export function QueuePage() {
  const all = [...jobs.value.values()].filter((job) => !job.deleted_at).sort((a, b) => (a.id < b.id ? 1 : -1));
  const active = all.filter((job) => PENDING.has(job.status)).reverse();
  const recent = all.filter((job) => !PENDING.has(job.status)).slice(0, 30);
  const owner = owners();
  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Queue</h1>
          <p class="muted">
            Heavy models (image, shape, detail, paint) run one at a time so Windows memory never runs out. The rest
            wait their turn as “Waiting its turn”.
          </p>
        </div>
      </header>
      <h2>Now</h2>
      {active.length === 0 ? (
        <p class="muted">Nothing is running.</p>
      ) : (
        <table class="table">
          <tbody>
            {active.map((job) => (
              <JobRow key={job.id} job={job} owner={owner.get(job.id)} />
            ))}
          </tbody>
        </table>
      )}
      <h2>Recently finished</h2>
      <table class="table">
        <tbody>
          {recent.map((job) => (
            <JobRow key={job.id} job={job} owner={owner.get(job.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATE_TEXT: Record<string, string> = {
  ready: "Ready",
  busy: "Working",
  loading: "Starting",
  error: "Error",
  unavailable: "Not running",
};

export function ModelsPage() {
  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Models</h1>
          <p class="muted">
            The local model servers behind each step. “Not running” usually means the studio was started without it
            (see OWNER-GUIDE.md) or it is still starting.
          </p>
        </div>
      </header>
      <table class="table">
        <thead>
          <tr>
            <th>Model</th>
            <th>State</th>
            <th>Does</th>
            <th>License</th>
          </tr>
        </thead>
        <tbody>
          {servers.value.map((server) => (
            <tr key={server.id}>
              <td>
                <b>{server.title}</b>
                <div class="muted small">{server.url}</div>
              </td>
              <td>
                <Dot state={server.state} /> {STATE_TEXT[server.state] ?? server.state}
                {server.message && <div class="small muted">{server.message}</div>}
              </td>
              <td class="small">{server.tasks.map((task) => taskLabel(task.task)).join(", ")}</td>
              <td class="small">
                {server.model?.license ?? "—"}
                {server.model?.source && (
                  <>
                    {" "}
                    <a href={server.model.source} target="_blank" rel="noreferrer">
                      source ↗
                    </a>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
