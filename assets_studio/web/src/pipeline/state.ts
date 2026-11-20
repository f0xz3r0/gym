// Game-asset documents and every action the pipeline UI can take. Actions
// start work and update the document; they never navigate.
import { signal } from "@preact/signals";

import { api, type Asset, type Job, type JobCreate } from "../api/client";
import { assetById, jobs, mergeJob, putAsset, servers } from "../state/store";
import { Conflict, pipelineApi, type GameAsset, type Kind, type StepState } from "./api";
import {
  chosen,
  conceptAsIs,
  conceptReference,
  referenceMode,
  type ReferenceMode,
  rigPose,
  rigReady,
  included,
  inputsNow,
  isStale,
  kindPurpose,
  paramsFor,
  PENDING,
  picked,
  sizePrompt,
  sources,
  stepJobs,
  withoutSize,
  STEPS,
  type StepDef,
  type StyleLock,
  type World,
  negativeWithLock,
  subjectSentence,
  withStyleLock,
} from "./steps";

// ------------------------------------------------------------------ documents

export const docs = signal<ReadonlyMap<string, GameAsset>>(new Map());
export const docsLoaded = signal(false);

function put(doc: GameAsset) {
  const next = new Map(docs.value);
  next.set(doc.id, doc);
  docs.value = next;
}

export async function loadDocs() {
  const list = await pipelineApi.list();
  docs.value = new Map(list.map((doc) => [doc.id, doc]));
  docsLoaded.value = true;
}

export async function loadDoc(id: string) {
  put(await pipelineApi.get(id));
}

/** Change a document and save it. If another window saved first, reload and
 * apply the same change again, so nothing is lost or overwritten. */
export async function update(id: string, change: (doc: GameAsset) => void): Promise<GameAsset> {
  for (let attempt = 0; ; attempt++) {
    const current = docs.value.get(id) ?? (await pipelineApi.get(id));
    const next = structuredClone(current);
    change(next);
    try {
      const saved = await pipelineApi.save(next);
      put(saved);
      return saved;
    } catch (error) {
      if (!(error instanceof Conflict) || attempt > 1) throw error;
      put(await pipelineApi.get(id));
    }
  }
}

export function stepOf(doc: GameAsset, id: string): StepState {
  doc.steps[id] ??= {};
  return doc.steps[id];
}

export async function createDoc(name: string, kind: Kind, idea: string) {
  const doc = await pipelineApi.create({ name, kind, idea });
  put(doc);
  return doc;
}

export async function deleteDoc(id: string) {
  await pipelineApi.remove(id);
  const next = new Map(docs.value);
  next.delete(id);
  docs.value = next;
}

// ------------------------------------------------------------------ world

export function worldOf(doc: GameAsset): World {
  return { doc, jobs: jobs.value, asset: assetById, servers: servers.value };
}

const fetching = new Set<string>();

/** Load jobs a document refers to that the live list does not hold (older ones). */
export function ensureJobs(ids: Iterable<string>) {
  for (const id of ids) {
    if (jobs.value.has(id) || fetching.has(id)) continue;
    fetching.add(id);
    void api
      .job(id)
      .then(mergeJob)
      .catch(() => undefined)
      .finally(() => fetching.delete(id));
  }
}

export const allJobIds = (doc: GameAsset) =>
  Object.values(doc.steps).flatMap((step) => step.jobs ?? []);

// ------------------------------------------------------------------ toasts

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "error";
}
export const toasts = signal<Toast[]>([]);
let toastId = 0;

export function toast(text: string, tone: Toast["tone"] = "info") {
  const item = { id: ++toastId, text, tone };
  toasts.value = [...toasts.value, item];
  window.setTimeout(
    () => (toasts.value = toasts.value.filter((other) => other.id !== item.id)),
    tone === "error" ? 9000 : 4000,
  );
}

/** Run an action; report a failure as a toast instead of throwing. */
export async function act<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  }
}

// ------------------------------------------------------------------ running steps

/** The edit instruction for drawing a concept from a reference picture. */
function referencePrompt(description: string, rigView: boolean) {
  const what = description.trim().replace(/[.\s]+$/, "");
  // the camera comes from the rig-ready pose when it is on (one camera only: "three-quarter" here turned a
  // rig-ready worker 45 degrees, 2026-11-12)
  const view = rigView ? "" : ", in a three-quarter or side view";
  return (
    "Redraw the object in this picture as a clean reference image for a 3D game asset" +
    (what ? `: ${what}.` : ".") +
    ` Keep its design, proportions and colours, except where the description asks for something else. Show the whole object alone${view},` +
    " on a plain light grey background, with soft even light, no ground shadow, no text and nothing else in the picture."
  );
}

/** The fixed edit instruction for "pose it for 3D": keep the picture's object exactly, change only pose, camera and
 * background. The rig-ready pose (front A-pose / strict side view) is appended by jobBody when it is on. */
function posePrompt(rigView: boolean) {
  return (
    "Keep the character or object in this picture exactly as it is: the same design, shape, proportions, colours, " +
    "materials, clothing and details. Do not redesign, restyle or add anything. Only change its pose and the camera " +
    "so it can be modelled in 3D: show the whole body, nothing cut off, nothing covering it" +
    (rigView ? "" : ", in a clear front or three-quarter view") +
    ", alone on a plain light grey background, with soft even light, no ground shadow, no text and nothing else in " +
    "the picture."
  );
}

/** Make the reference picture itself the concept result (and the pick), on a document being updated. */
function useReferenceAsIs(next: GameAsset, reference: string) {
  const state = stepOf(next, "concept");
  state.extra = [...(state.extra ?? []).filter((id) => id !== reference), reference];
  state.pick = reference;
}

export const setReferenceMode = (doc: GameAsset, mode: ReferenceMode) =>
  update(doc.id, (next) => {
    const state = stepOf(next, "concept");
    state.referenceMode = mode;
    if (mode === "as-is" && state.reference) useReferenceAsIs(next, state.reference);
  });

export const setRigReady = (doc: GameAsset, on: boolean) =>
  update(doc.id, (next) => void (stepOf(next, "concept").rigReady = on));

export const setReference = (doc: GameAsset, asset: string | null) =>
  update(doc.id, (next) => {
    const state = stepOf(next, "concept");
    state.reference = asset;
    if (asset && (state.referenceMode ?? "pose") === "as-is") useReferenceAsIs(next, asset);
  });

/** The style lock of the asset's profile (default profile when none is chosen); undefined if the list cannot load. */
let profileOptions: ReturnType<typeof pipelineApi.profiles> | undefined;
export async function styleLockOf(doc: GameAsset): Promise<StyleLock | undefined> {
  try {
    profileOptions ??= pipelineApi.profiles();
    const options = await profileOptions;
    return options.style_locks?.[doc.profile || options.default_profile];
  } catch {
    profileOptions = undefined;
    return undefined;
  }
}

function jobBody(
  world: World,
  step: StepDef,
  inputs: Record<string, string>,
  extra: Record<string, unknown> = {},
  lock?: StyleLock,
): JobCreate {
  const choice = chosen(world, step);
  if (!choice) throw new Error(`No model is set up for “${step.title}”.`);
  const body: JobCreate = {
    server: choice.server.id,
    task: choice.task.task,
    count: 1,
    params: { ...paramsFor(world, step, choice.task), ...extra },
    inputs,
    dependencies: {},
  };
  if (choice.task.prompt !== "none") {
    const prompt = (world.doc.prompt || world.doc.idea).trim();
    if (!prompt && choice.task.prompt === "required" && !(step.id === "concept" && conceptReference(world.doc)))
      throw new Error("Describe the object first.");
    body.prompt = prompt;
  }
  const reference = step.id === "concept" ? conceptReference(world.doc) : undefined;
  if (reference) {
    body.inputs = { ...inputs, image: reference };
    const rigView = rigReady(world.doc) && rigPose(world.doc.kind) !== "";
    body.prompt =
      referenceMode(world.doc) === "redraw"
        ? referencePrompt(world.doc.prompt || world.doc.idea, rigView)
        : posePrompt(rigView);
  }
  // the real size goes on after the description writer, so it cannot be dropped
  const size = step.id === "concept" ? sizePrompt(world.doc) : "";
  if (size && typeof body.prompt === "string") body.prompt = `${withoutSize(body.prompt).replace(/\.?$/, ".")} ${size}`.trim();
  if (step.id === "concept" && rigReady(world.doc) && body.prompt) {
    body.prompt = body.prompt.trim().replace(/\.?$/, ".") + rigPose(world.doc.kind);
  }
  // the 3D style lock of the asset's profile (B37), put first (B46): suffix and palette, and the negative where taken
  if (step.id === "concept" && lock) {
    if (typeof body.prompt === "string") body.prompt = withStyleLock(body.prompt, lock, subjectSentence(world.doc.name));
    const negative = body.params?.negative_prompt;
    if (typeof negative === "string") body.params = { ...body.params, negative_prompt: negativeWithLock(negative, lock) };
  }
  return body;
}

/** Start one step now with the current picks. `variations` only for images. */
/** Start one step now with the current picks. `variations` only for images; `extra` overrides settings for this run
 * only (the motion step's "Animate this video" sends the reviewed clip). */
export async function runStep(
  doc: GameAsset,
  step: StepDef,
  variations = 1,
  extra: Record<string, unknown> = {},
  inputsOverride?: Record<string, string>,
) {
  if (step.id === "concept" && conceptAsIs(doc)) {
    // "Use as is": nothing to generate, the picture itself is the concept
    await update(doc.id, (next) => useReferenceAsIs(next, conceptReference(doc)!));
    return [];
  }
  const world = worldOf(doc);
  let inputs: Record<string, string> = {};
  if (Object.keys(step.from).length) {
    const now = inputsNow(world, step);
    if (!("inputs" in now))
      throw new Error(now.missing ? `Finish “${now.missing.title}” first.` : "Turn on an earlier step first.");
    inputs = now.inputs;
  }
  // a re-run of one result (the Tune panel) uses that result's own inputs, whatever is picked now
  if (inputsOverride) inputs = { ...inputs, ...inputsOverride };
  const body = jobBody(world, step, inputs, extra, step.id === "concept" ? await styleLockOf(doc) : undefined);
  const max = chosen(world, step)?.task.max_count ?? 1;
  const created: Job[] = [];
  if (variations > 1 && max >= variations) created.push(await api.createJob({ ...body, count: variations }));
  else for (let index = 0; index < variations; index++) created.push(await api.createJob(body));
  created.forEach(mergeJob);
  await update(doc.id, (next) => {
    const state = stepOf(next, step.id);
    state.jobs = [...(state.jobs ?? []), ...created.map((job) => job.id)];
    state.pick = null; // the new result becomes the pick when it arrives
  });
  return created;
}

export interface ChainPlan {
  run: StepDef[];
  problem?: string;
}

/** What "Run remaining steps" would start: every included step that has no
 * up-to-date result, plus everything after a step that is redone. */
export function planRemaining(doc: GameAsset): ChainPlan {
  const world = worldOf(doc);
  const redo = new Set<string>();
  const run: StepDef[] = [];
  for (const step of STEPS) {
    if (!included(doc, step)) continue;
    if (!chosen(world, step)) return { run, problem: `No model is set up for “${step.title}”.` };
    if (step.userInput && !stepOf(doc, step.id).reference) continue; // waits for the user's pick
    if (step.id === "concept" && conceptAsIs(doc)) continue; // the user's own picture is the concept
    const pending = stepJobs(world, step).some((job) => PENDING.has(job.status));
    const upstreamRedone = Object.values(sources(world, step)).some((source) => source && redo.has(source.id));
    const current = picked(world, step) && !isStale(world, step);
    if (pending && !upstreamRedone) continue; // already on its way
    if (current && !upstreamRedone) continue;
    if (step.id === "concept" && !conceptReference(doc) && !(doc.prompt || doc.idea).trim())
      return { run, problem: "Describe the object first." };
    redo.add(step.id);
    run.push(step);
  }
  return { run };
}

/** Start the plan as one chain: each job waits for the job before it on the
 * studio itself, so it continues even with this window closed. */
export async function runRemaining(doc: GameAsset, status?: (text: string) => void) {
  if (conceptAsIs(doc) && picked(worldOf(doc), STEPS[0]!)?.asset.id !== conceptReference(doc))
    doc = await update(doc.id, (next) => useReferenceAsIs(next, conceptReference(doc)!));
  // a reference picture needs no written description ("pose" has its own prompt; "redraw" uses what is typed)
  if (planRemaining(doc).run.some((step) => step.id === "concept") && !conceptReference(doc))
    doc = await ensureDescription(doc, status);
  const plan = planRemaining(doc);
  if (plan.problem) throw new Error(plan.problem);
  const world = worldOf(doc);
  const scheduled = new Map<string, Job>();
  for (const step of plan.run) {
    const inputs: Record<string, string> = {};
    const dependencies: NonNullable<JobCreate["dependencies"]> = {};
    for (const [role, source] of Object.entries(sources(world, step))) {
      if (!source) throw new Error(`“${step.title}” needs an earlier step turned on.`);
      const upstream =
        scheduled.get(source.id) ??
        stepJobs(world, source).find((job) => PENDING.has(job.status) && !picked(world, source));
      if (upstream) dependencies[role] = { job_id: upstream.id, output_index: 0 };
      else {
        const result = picked(world, source);
        if (!result) throw new Error(`Finish “${source.title}” first.`);
        inputs[role] = result.asset.id;
      }
    }
    const picked_ = step.userInput ? stepOf(doc, step.id).reference : null;
    if (step.userInput && picked_) inputs[step.userInput.role] = picked_;
    const lock = step.id === "concept" ? await styleLockOf(doc) : undefined;
    const job = await api.createJob({ ...jobBody(world, step, inputs, {}, lock), dependencies });
    mergeJob(job);
    scheduled.set(step.id, job);
  }
  await update(doc.id, (next) => {
    for (const [id, job] of scheduled) {
      const state = stepOf(next, id);
      state.jobs = [...(state.jobs ?? []), job.id];
      state.pick = null;
    }
  });
  return plan.run;
}

export async function cancelJob(job: Job) {
  mergeJob(await api.cancelJob(job.id));
}

export async function retryJob(doc: GameAsset, step: StepDef, job: Job) {
  const again = await api.retryJob(job.id);
  mergeJob(again);
  await update(doc.id, (next) => {
    const state = stepOf(next, step.id);
    state.jobs = [...(state.jobs ?? []), again.id];
    state.pick = null;
  });
}

export const pick = (doc: GameAsset, step: StepDef, asset: Asset) =>
  update(doc.id, (next) => void (stepOf(next, step.id).pick = asset.id));

export const addExisting = (doc: GameAsset, step: StepDef, asset: Asset) =>
  update(doc.id, (next) => {
    const state = stepOf(next, step.id);
    state.extra = [...(state.extra ?? []).filter((id) => id !== asset.id), asset.id];
    state.pick = asset.id;
  });

export async function upload(doc: GameAsset, step: StepDef, file: File) {
  const asset = await api.upload(file, `${doc.name} · ${step.title}`);
  putAsset(asset);
  await addExisting(doc, step, asset);
  return asset;
}

export const setIncluded = (doc: GameAsset, step: StepDef, on: boolean) =>
  update(doc.id, (next) => void (stepOf(next, step.id).include = on));

export const setServer = (doc: GameAsset, step: StepDef, server: string) =>
  update(doc.id, (next) => void (stepOf(next, step.id).server = server));

export const setParams = (doc: GameAsset, step: StepDef, params: Record<string, unknown>) =>
  update(doc.id, (next) => void (stepOf(next, step.id).params = params));

// ------------------------------------------------------------------ prompt writer

export const WRITER = "asset-prompt-agent";

export async function writePrompt(doc: GameAsset): Promise<Job> {
  const idea = (doc.idea || doc.prompt).trim();
  if (!idea) throw new Error("Type a short idea first, e.g. “rusty wheelbarrow”.");
  // the writer also gets the size so its description agrees with it (the size itself is added to the concept prompt)
  const size = sizePrompt(doc);
  const job = await api.createJob({
    server: WRITER,
    task: "asset-prompt",
    prompt: size ? `${withoutSize(idea).replace(/\.?$/, ".")} ${size}` : idea,
    count: 1,
    params: { purpose: kindPurpose(doc.kind) },
    inputs: {},
    dependencies: {},
  });
  mergeJob(job);
  await update(doc.id, (next) => {
    const state = stepOf(next, "prompt");
    state.jobs = [...(state.jobs ?? []), job.id];
  });
  return job;
}

/** True when the concept would be drawn from the short idea alone (no written description): the image model then
 * gets no construction, materials or camera, so a concept is never run from it. */
export function needsDescription(doc: GameAsset): boolean {
  const text = (doc.prompt || "").trim();
  return !text || text === doc.idea.trim() || text.split(/\s+/).length < 25;
}

/** Before a concept run: write the detailed description from the short idea when there is none (the local
 * prompt writer, about 30 s), use it, and return the saved document. Without the writer the document is returned
 * unchanged. */
export async function ensureDescription(doc: GameAsset, status?: (text: string) => void): Promise<GameAsset> {
  if (!needsDescription(doc) || !(doc.idea || doc.prompt).trim()) return doc;
  if (!servers.value.some((server) => server.id === WRITER)) return doc;
  status?.("Writing a detailed description from the short idea first (about 30 s)…");
  let job = await writePrompt(doc);
  const deadline = Date.now() + 5 * 60_000;
  while (PENDING.has(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    job = await api.job(job.id);
    mergeJob(job);
  }
  if (job.status !== "succeeded" || !job.outputs[0])
    throw new Error("The description could not be written: " + (job.error_message ?? job.status));
  const asset = await api.asset(job.outputs[0]);
  putAsset(asset);
  const text = (await assetText(asset)).trim();
  return usePrompt(docs.value.get(doc.id) ?? doc, text);
}

/** Use a written prompt: the writer adds camera and styling itself, so the
 * image model's own "game asset reference" suffix is turned off. */
export const usePrompt = (doc: GameAsset, text: string) =>
  update(doc.id, (next) => {
    next.prompt = text;
    const concept = stepOf(next, "concept");
    concept.params = { ...(concept.params ?? {}), asset_reference: false };
  });

const texts = new Map<string, Promise<string>>();
export function assetText(asset: Asset): Promise<string> {
  let text = texts.get(asset.id);
  if (!text) {
    text = fetch(asset.file_url).then((response) => {
      if (!response.ok) throw new Error("Could not read " + asset.file_url);
      return response.text();
    });
    texts.set(asset.id, text);
  }
  return text;
}
