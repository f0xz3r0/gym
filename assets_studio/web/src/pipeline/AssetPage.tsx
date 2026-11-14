// One game asset: every step from idea to Godot on one page, with a large
// preview beside it. Nothing here navigates away.
import { useEffect, useRef, useState } from "preact/hooks";

import { assetById } from "../state/store";
import type { GameAsset } from "./api";
import { GodotCard } from "./GodotCard";
import { facts, Preview } from "./Preview";
import { StepCard, type Selection } from "./StepCard";
import {
  act,
  allJobIds,
  deleteDoc,
  docs,
  ensureJobs,
  loadDoc,
  pick,
  planRemaining,
  runRemaining,
  toast,
  update,
  worldOf,
} from "./state";
import { finalResult, included, KINDS, PENDING, picked, results, status, stepById, stepJobs, STEPS } from "./steps";
import { ConfirmButton, Modal } from "./ui";
import { WorkingPreview } from "./Working";

export function AssetPage({ id }: { id: string }) {
  const doc = docs.value.get(id);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!doc) void loadDoc(id).catch(() => setMissing(true));
  }, [id]);
  if (missing)
    return (
      <div class="page narrow">
        <h1>Not found</h1>
        <p>This game asset no longer exists.</p>
        <a class="button" href="#/">
          Back to all assets
        </a>
      </div>
    );
  if (!doc) return <div class="page center"><span class="spinner" /></div>;
  return <Loaded doc={doc} />;
}

function Loaded({ doc }: { doc: GameAsset }) {
  const world = worldOf(doc);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => ensureJobs(allJobIds(doc)), [doc.rev]);

  // The preview follows your clicks; until then it shows the newest finished step.
  const final = finalResult(world);
  const fallback = final
    ? { step: final.step.id, asset: final.result.asset.id }
    : (() => {
        for (const step of [...STEPS].reverse()) {
          const result = picked(world, step);
          if (result) return { step: step.id, asset: result.asset.id };
        }
        return null;
      })();
  const shown = selection ?? fallback;

  // A step at work takes the preview (an animation with its progress) until you click a result; a newly started
  // run takes it back.
  const active = STEPS.flatMap((step) => {
    if (!included(doc, step)) return [];
    const job = stepJobs(world, step).find((item) => PENDING.has(item.status));
    return job ? [{ step, job }] : [];
  });
  const working = selection ? undefined : (active.find((item) => item.job.status === "running") ?? active[0]);
  // the model the preview shows: a finished animation of this step made from the same rig as the running job (it
  // plays as it is), else the rig or mesh the job works on (the hologram with an idle). An animation from an older
  // rig of the same creature is not shown: it is not what this run makes.
  const workingRig = working?.job.inputs.rig;
  const workingModel = working
    ? ((["motion", "textmotion", "mocap", "animate"].includes(working.step.id) && workingRig
        ? results(world, working.step).find((result) => result.job?.inputs.rig === workingRig)?.asset.id
        : undefined) ?? workingRig ?? working.job.inputs.mesh)
    : undefined;
  const seenJobs = useRef<Set<string>>(new Set(active.map((item) => item.job.id)));
  useEffect(() => {
    const fresh = active.some((item) => !seenJobs.current.has(item.job.id));
    active.forEach((item) => seenJobs.current.add(item.job.id));
    if (fresh) setSelection(null);
  }, [active.map((item) => item.job.id).join(",")]);
  const shownAsset = shown ? assetById(shown.asset) : undefined;
  const shownStep = shown ? stepById(shown.step) : undefined;
  const shownIsPick = shownStep && shownAsset && picked(world, shownStep)?.asset.id === shownAsset.id;

  const plan = planRemaining(doc);
  const rigStep = stepById("rig");
  // The test animation only makes sense once a skeleton step is on.
  // "animate" retargets onto the Skeleton step's rig; "motion" (v1.1) makes its own rig, so it is always offered
  // "animate" retargets onto the Skeleton step's rig; "motion" needs the Animation rig step
  const animRig = stepById("animrig");
  const steps = STEPS.filter(
    (step) =>
      (step.id !== "animate" ||
        (rigStep !== undefined && included(doc, rigStep)) ||
        (animRig !== undefined && included(doc, animRig))) &&
      (!["motion", "textmotion", "mocap"].includes(step.id) || (animRig !== undefined && included(doc, animRig))),
  );
  const kind = KINDS.find((item) => item.id === doc.kind);

  return (
    <div class="asset-page">
      <header class="asset-head">
        <a class="back" href="#/">
          ← All assets
        </a>
        <div class="asset-title">
          <h1>{doc.name}</h1>
          <span class="chip">{kind?.label}</span>
          <button class="button small ghost" onClick={() => setRenaming(true)}>
            Rename
          </button>
        </div>
        <span class="spacer" />
        {plan.run.length > 0 ? (
          <button class="button primary" onClick={() => setConfirmRun(true)}>
            ▶ Run remaining steps ({plan.run.length})
          </button>
        ) : (
          <span class="muted">Every step is done or running.</span>
        )}
      </header>

      <nav class="stepper" aria-label="Steps">
        {steps.map((step) => {
          const state = status(world, step);
          return (
            <a key={step.id} href={`#/a/${doc.id}`} class={`stepper-item s-${state}`} title={step.title}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`step-${step.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
              <span class="stepper-dot" />
              <span class="stepper-label">{step.title}</span>
            </a>
          );
        })}
        <a href={`#/a/${doc.id}`} class="stepper-item" onClick={(event) => {
          event.preventDefault();
          document.getElementById("step-godot")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}>
          <span class="stepper-dot" />
          <span class="stepper-label">Godot</span>
        </a>
      </nav>

      <div class="asset-body">
        <div class="steps">
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
              doc={doc}
              step={step}
              number={index + 1}
              selected={shown}
              onSelect={setSelection}
            />
          ))}
          <GodotCard doc={doc} number={steps.length + 1} />
          <div class="danger-zone">
            <ConfirmButton
              label="Delete this game asset"
              confirm="Click again to delete (library results are kept)"
              onConfirm={() =>
                void act(() => deleteDoc(doc.id)).then(() => {
                  window.location.hash = "#/";
                  toast(`Deleted “${doc.name}”. Its results are still in the library.`);
                })
              }
            />
          </div>
        </div>

        <aside class="preview-pane">
          <div class="preview-box">
            {working ? (
              <WorkingPreview step={working.step} job={working.job} model={workingModel} />
            ) : (
              <Preview asset={shownAsset} />
            )}
          </div>
          {!working && shownAsset && shownStep && (
            <div class="preview-info">
              <div class="row">
                <b>{shownStep.title}</b>
                {shownIsPick ? (
                  <span class="chip chip-done">Used for the next step</span>
                ) : (
                  <button
                    class="button small primary"
                    onClick={() => void act(() => pick(doc, shownStep, shownAsset))}
                  >
                    Use this result
                  </button>
                )}
              </div>
              <p class="muted small">{facts(shownAsset).join(" · ")}</p>
              <div class="row">
                <a class="button small" href={shownAsset.file_url} download>
                  Download
                </a>
                <a class="button small ghost" href={`#/library/${shownAsset.id}`} target="_blank" rel="noreferrer">
                  Open in library ↗
                </a>
              </div>
            </div>
          )}
        </aside>
      </div>

      {confirmRun && (
        <Modal title="Run remaining steps" onClose={() => setConfirmRun(false)}>
          {plan.problem ? (
            <p class="note error">{plan.problem}</p>
          ) : (
            <>
              <p>These steps will run one after another, each using the result of the one before:</p>
              <ol class="plan">
                {plan.run.map((step) => (
                  <li key={step.id}>
                    <b>{step.title}</b> <span class="muted">· {step.typical}</span>
                  </li>
                ))}
              </ol>
              <p class="muted small">
                It keeps going on the studio even if you close this window. The first result of each step is used;
                you can pick a different one afterwards and run later steps again.
              </p>
            </>
          )}
          <footer class="modal-actions">
            <button class="button ghost" onClick={() => setConfirmRun(false)}>
              Cancel
            </button>
            <button
              class="button primary"
              disabled={!!plan.problem}
              onClick={() => {
                setConfirmRun(false);
                void act(() => runRemaining(doc, (text) => toast(text, "good"))).then(
                  (ran) => ran && toast(`Started ${ran.length} steps. Progress shows on each step.`, "good"),
                );
              }}
            >
              Start
            </button>
          </footer>
        </Modal>
      )}

      {renaming && <Rename doc={doc} onClose={() => setRenaming(false)} />}
    </div>
  );
}

function Rename({ doc, onClose }: { doc: GameAsset; onClose: () => void }) {
  const [name, setName] = useState(doc.name);
  const [kind, setKind] = useState(doc.kind);
  return (
    <Modal title="Rename" onClose={onClose}>
      <label class="field">
        <span>Name</span>
        <input value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Kind</span>
        <select value={kind} onChange={(event) => setKind(event.currentTarget.value as GameAsset["kind"])}>
          {KINDS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} — {item.hint}
            </option>
          ))}
        </select>
      </label>
      <footer class="modal-actions">
        <button class="button ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          class="button primary"
          disabled={!name.trim()}
          onClick={() =>
            void act(() =>
              update(doc.id, (next) => {
                next.name = name.trim();
                next.kind = kind;
              }),
            ).then(onClose)
          }
        >
          Save
        </button>
      </footer>
    </Modal>
  );
}

