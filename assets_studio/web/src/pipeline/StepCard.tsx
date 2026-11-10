// One pipeline step: what it does, its model and settings, its results, and
// buttons that start work right here.
import { useEffect, useState } from "preact/hooks";

import type { Asset } from "../api/client";
import { ParamsForm, type Texts } from "../components/ParamsForm";
import type { GameAsset } from "./api";
import { Picker } from "./Picker";
import { Thumb } from "./Preview";
import {
  act,
  addExisting,
  assetText,
  cancelJob,
  retryJob,
  runStep,
  setIncluded,
  setParams,
  setServer,
  toast,
  update,
  upload,
  usePrompt,
  worldOf,
  writePrompt,
  WRITER,
} from "./state";
import {
  candidates,
  chosen,
  inputsNow,
  paramsFor,
  PENDING,
  picked,
  results,
  sources,
  status,
  stepJobs,
  type StepDef,
} from "./steps";
import { Dot, JobProgress, StatusChip } from "./ui";

/** Descriptions typed but maybe not saved yet, by game asset. */
const promptDrafts = new Map<string, string>();

export interface Selection {
  step: string;
  asset: string;
}

export function StepCard({
  doc,
  step,
  number,
  selected,
  onSelect,
}: {
  doc: GameAsset;
  step: StepDef;
  number: number;
  selected: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const world = worldOf(doc);
  const state = status(world, step);
  const jobs = stepJobs(world, step);
  const running = jobs.filter((job) => PENDING.has(job.status));
  const latest = jobs[0];
  const list = results(world, step);
  const current = picked(world, step);
  const options = candidates(step, world.servers);
  const choice = chosen(world, step);
  const [settings, setSettings] = useState(false);
  const [texts, setTexts] = useState<Texts>({});
  const [adding, setAdding] = useState(false);
  const [variations, setVariations] = useState(1);
  const [starting, setStarting] = useState(false);

  if (state === "off")
    return (
      <section class="step off" id={`step-${step.id}`}>
        <header class="step-head">
          <span class="step-number">{number}</span>
          <div class="step-title">
            <h3>{step.title}</h3>
            <p class="muted">{step.blurb}</p>
          </div>
          <button class="button small" onClick={() => void act(() => setIncluded(doc, step, true))}>
            Include this step
          </button>
        </header>
      </section>
    );

  const now = inputsNow(world, step);
  const missing = "missing" in now ? now.missing : undefined;
  const failedJob = latest?.status === "failed" ? latest : undefined;

  async function run() {
    setStarting(true);
    const started = await act(async () => {
      // A description typed but not yet saved is saved first, so the run uses it.
      const draft = promptDrafts.get(doc.id);
      const latest =
        step.id === "concept" && draft !== undefined && draft !== doc.prompt
          ? await update(doc.id, (next) => void (next.prompt = draft))
          : doc;
      return runStep(latest, step, step.id === "concept" ? variations : 1);
    });
    setStarting(false);
    if (started) toast(`${step.title}: started. You can keep working; it runs in the background.`, "good");
  }

  return (
    <section class={`step state-${state}`} id={`step-${step.id}`}>
      <header class="step-head">
        <span class="step-number">{state === "done" ? "✓" : number}</span>
        <div class="step-title">
          <h3>
            {step.title} <StatusChip status={state} />
          </h3>
          <p class="muted">{step.blurb}</p>
        </div>
        {step.optional && (
          <button
            class="button small ghost"
            title="Leave this step out of the pipeline"
            onClick={() => void act(() => setIncluded(doc, step, false))}
          >
            Skip
          </button>
        )}
      </header>

      {step.id === "concept" && <ConceptPrompt doc={doc} />}

      {list.length > 0 && (
        <div class="results" role="list" aria-label={`${step.title} results`}>
          {list.map(({ asset }) => {
            const isPick = current?.asset.id === asset.id;
            const isSelected = selected?.asset === asset.id;
            return (
              <button
                key={asset.id}
                role="listitem"
                class={`result${isPick ? " picked" : ""}${isSelected ? " selected" : ""}`}
                title={isPick ? "Used for the next step" : "Click to preview"}
                onClick={() => onSelect({ step: step.id, asset: asset.id })}
              >
                <span class="thumb">
                  <Thumb asset={asset} />
                </span>
                {isPick && <span class="pick-badge">Using</span>}
              </button>
            );
          })}
        </div>
      )}

      {running.map((job) => (
        <div class="job-line" key={job.id}>
          <JobProgress job={job} typical={step.typical} />
          <button class="button small ghost" onClick={() => void act(() => cancelJob(job))}>
            Cancel
          </button>
        </div>
      ))}

      {state === "stale" && (
        <p class="note warn">
          This result was made from an older version of an earlier step. Run it again to bring it up to date, or keep it as it is.
        </p>
      )}
      {failedJob && running.length === 0 && (
        <div class="note error">
          <b>Last run failed.</b> {failedJob.error_message ?? "No details were given."}
          <div class="note-actions">
            <button class="button small" onClick={() => void act(() => retryJob(doc, step, failedJob))}>
              Try again
            </button>
          </div>
        </div>
      )}
      {state === "blocked" && (
        <p class="note">
          {missing ? <>Needs a result from <b>{missing.title}</b> first.</> : "Turn on an earlier step that this one can build from."}
        </p>
      )}
      {state === "nomodel" && (
        <p class="note warn">
          The model for this step is not set up. See OWNER-GUIDE.md, section 3.
        </p>
      )}

      <footer class="step-actions">
        <button
          class={`button ${state === "ready" || state === "failed" || state === "stale" ? "primary" : ""}`}
          disabled={starting || state === "blocked" || state === "nomodel" || (state === "running" && step.id !== "concept")}
          title={state === "running" && step.id !== "concept" ? "Already running" : undefined}
          onClick={() => void run()}
        >
          {starting ? "Starting…" : list.length || jobs.length ? "Run again" : "Run"}
        </button>
        {step.id === "concept" && (
          <label class="inline">
            <select value={variations} onChange={(event) => setVariations(Number(event.currentTarget.value))}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value === 1 ? "1 image" : `${value} images`}
                </option>
              ))}
            </select>
          </label>
        )}
        {options.length > 1 && choice ? (
          <label class="inline model-select">
            <Dot state={choice.server.state} />
            <select
              value={choice.server.id}
              onChange={(event) => void act(() => setServer(doc, step, event.currentTarget.value))}
            >
              {options.map(({ server }, index) => (
                <option key={server.id} value={server.id}>
                  {server.title}
                  {index === 0 && !/recommended/i.test(server.title) ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          choice && (
            <span class="inline muted model-name">
              <Dot state={choice.server.state} /> {choice.server.title}
            </span>
          )
        )}
        <span class="spacer" />
        {(step.produces === "image" || step.id === "shape") && (
          <button class="button small ghost" onClick={() => setAdding(true)}>
            Use my own…
          </button>
        )}
        {choice && (
          <button class="button small ghost" aria-expanded={settings} onClick={() => setSettings(!settings)}>
            {settings ? "Hide settings" : "Settings"}
          </button>
        )}
      </footer>

      {choice && (choice.server.state === "unavailable" || choice.server.state === "error") && state !== "done" && (
        <p class="muted small">
          {choice.server.title} is not running right now. Jobs you start wait until it is (start it with Assets Studio.vbs).
        </p>
      )}

      {settings && choice && (
        <Settings
          step={step}
          values={paramsFor(world, step, choice.task)}
          schema={choice.task.params_schema}
          texts={texts}
          onChange={(values, nextTexts) => {
            setTexts(nextTexts);
            void act(() => setParams(doc, step, values));
          }}
          onReset={() => {
            setTexts({});
            void act(() => setParams(doc, step, {}));
          }}
          sourcesText={Object.entries(sources(world, step))
            .map(([role, source]) => `${role} ← ${source?.title ?? "nothing"}`)
            .join(" · ")}
        />
      )}

      {adding && (
        <Picker
          kind={step.produces}
          title={`Use your own ${step.produces === "image" ? "image" : "3D model (.glb)"} for “${step.title}”`}
          onPick={(asset: Asset) => {
            void act(() => addExisting(doc, step, asset));
            onSelect({ step: step.id, asset: asset.id });
          }}
          onUpload={(file) => upload(doc, step, file)}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function Settings({
  step,
  schema,
  values,
  texts,
  onChange,
  onReset,
  sourcesText,
}: {
  step: StepDef;
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  texts: Texts;
  onChange: (values: Record<string, unknown>, texts: Texts) => void;
  onReset: () => void;
  sourcesText: string;
}) {
  return (
    <div class="settings">
      <div class="settings-grid">
        <ParamsForm schema={schema} values={values} texts={texts} primary={true} onChange={onChange} />
        <ParamsForm schema={schema} values={values} texts={texts} primary={false} onChange={onChange} />
      </div>
      <div class="settings-foot">
        {sourcesText && <span class="muted">Uses: {sourcesText}</span>}
        <span class="spacer" />
        <button class="button small ghost" onClick={onReset}>
          Reset to recommended
        </button>
      </div>
      {step.heavy && <p class="muted small">Heavy step: it waits for other heavy steps to finish, so memory never runs out.</p>}
    </div>
  );
}

/** The description for the concept image, with the local prompt writer. */
function ConceptPrompt({ doc }: { doc: GameAsset }) {
  const world = worldOf(doc);
  const [text, setText] = useState(doc.prompt || doc.idea);
  const [idea, setIdea] = useState(doc.idea);
  const [written, setWritten] = useState<{ id: string; text: string } | null>(null);
  const writer = world.servers.find((server) => server.id === WRITER);
  const writerJobs = (doc.steps.prompt?.jobs ?? [])
    .map((id) => world.jobs.get(id))
    .filter((job) => job !== undefined)
    .reverse();
  const pending = writerJobs.find((job) => PENDING.has(job.status));
  const done = writerJobs.find((job) => job.status === "succeeded");
  const failed = writerJobs[0]?.status === "failed" ? writerJobs[0] : undefined;
  const writtenAsset = done?.outputs[0] ? world.asset(done.outputs[0]) : undefined;

  useEffect(() => setText(doc.prompt || doc.idea), [doc.prompt]);
  useEffect(() => {
    if (!writtenAsset) return;
    void assetText(writtenAsset).then((value) => setWritten({ id: writtenAsset.id, text: value.trim() }));
  }, [writtenAsset?.id]);

  const save = () => {
    if (text !== (doc.prompt || doc.idea)) void act(() => update(doc.id, (next) => void (next.prompt = text)));
  };

  return (
    <div class="concept">
      {writer && (
        <div class="writer">
          <label class="field grow">
            <span>Short idea</span>
            <input
              value={idea}
              placeholder="e.g. rusty wheelbarrow"
              onInput={(event) => setIdea(event.currentTarget.value)}
              onBlur={() => idea !== doc.idea && void act(() => update(doc.id, (next) => void (next.idea = idea)))}
            />
          </label>
          <button
            class="button"
            disabled={!!pending || !idea.trim()}
            title="The local writer turns a short idea into a detailed image description"
            onClick={() =>
              void act(async () => {
                const saved = idea === doc.idea ? doc : await update(doc.id, (next) => void (next.idea = idea));
                await writePrompt(saved);
              })
            }
          >
            {pending ? "Writing…" : "✨ Write a detailed description"}
          </button>
        </div>
      )}
      {pending && <JobProgress job={pending} typical="about 30 s" />}
      {failed && !pending && <p class="note error">The prompt writer failed: {failed.error_message}</p>}
      {written && written.text !== text && !pending && (
        <div class="note suggestion">
          <b>Suggested description</b>
          <p>{written.text}</p>
          <div class="note-actions">
            <button
              class="button small primary"
              onClick={() => void act(() => usePrompt(doc, written.text)).then(() => setText(written.text))}
            >
              Use this description
            </button>
          </div>
        </div>
      )}
      <label class="field">
        <span>Image description</span>
        <textarea
          rows={4}
          value={text}
          placeholder="Describe one object: its parts, materials and shape."
          onInput={(event) => {
            setText(event.currentTarget.value);
            promptDrafts.set(doc.id, event.currentTarget.value);
          }}
          onBlur={save}
        />
      </label>
    </div>
  );
}
