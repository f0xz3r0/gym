// Game-asset documents and every action the pipeline UI can take. Actions
// start work and update the document; they never navigate.
import { signal } from "@preact/signals";

import { api, type Asset, type Job, type JobCreate } from "../api/client";
import { assetById, jobs, mergeJob, putAsset, servers } from "../state/store";
import { Conflict, pipelineApi, type GameAsset, type Kind, type StepState } from "./api";
import {
  chosen,
  included,
  inputsNow,
  isStale,
  kindPurpose,
  paramsFor,
  PENDING,
  picked,
  sources,
  stepJobs,
  STEPS,
  type StepDef,
  type World,
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

function jobBody(world: World, step: StepDef, inputs: Record<string, string>): JobCreate {
  const choice = chosen(world, step);
  if (!choice) throw new Error(`No model is set up for “${step.title}”.`);
  const body: JobCreate = {
    server: choice.server.id,
    task: step.task,
    count: 1,
    params: paramsFor(world, step, choice.task),
    inputs,
    dependencies: {},
  };
  if (choice.task.prompt !== "none") {
    const prompt = (world.doc.prompt || world.doc.idea).trim();
    if (!prompt && choice.task.prompt === "required")
      throw new Error("Describe the object first.");
    body.prompt = prompt;
  }
  return body;
}

/** Start one step now with the current picks. `variations` only for images. */
export async function runStep(doc: GameAsset, step: StepDef, variations = 1) {
  const world = worldOf(doc);
  let inputs: Record<string, string> = {};
  if (Object.keys(step.from).length) {
    const now = inputsNow(world, step);
    if (!("inputs" in now))
      throw new Error(now.missing ? `Finish “${now.missing.title}” first.` : "Turn on an earlier step first.");
    inputs = now.inputs;
  }
  const body = jobBody(world, step, inputs);
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
    const pending = stepJobs(world, step).some((job) => PENDING.has(job.status));
    const upstreamRedone = Object.values(sources(world, step)).some((source) => source && redo.has(source.id));
    const current = picked(world, step) && !isStale(world, step);
    if (pending && !upstreamRedone) continue; // already on its way
    if (current && !upstreamRedone) continue;
    if (step.id === "concept" && !(doc.prompt || doc.idea).trim())
      return { run, problem: "Describe the object first." };
    redo.add(step.id);
    run.push(step);
  }
  return { run };
}

/** Start the plan as one chain: each job waits for the job before it on the
 * studio itself, so it continues even with this window closed. */
export async function runRemaining(doc: GameAsset) {
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
    const job = await api.createJob({ ...jobBody(world, step, inputs), dependencies });
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

export async function writePrompt(doc: GameAsset) {
  const idea = (doc.idea || doc.prompt).trim();
  if (!idea) throw new Error("Type a short idea first, e.g. “rusty wheelbarrow”.");
  const job = await api.createJob({
    server: WRITER,
    task: "asset-prompt",
    prompt: idea,
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
