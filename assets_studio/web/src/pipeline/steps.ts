// The game-asset pipeline: which steps exist, which model does each, and how a
// step's inputs come from earlier steps. Everything here is pure: it reads the
// document, the jobs and the assets, and never changes them.
import type { Asset, Job, Server, Task } from "../api/client";
import type { GameAsset, Kind, StepState } from "./api";

export type StepId =
  | "concept"
  | "cutout"
  | "shape"
  | "detail"
  | "cleanup"
  | "gamemesh"
  | "paint"
  | "normals"
  | "rig"
  | "animate";

export interface StepDef {
  id: StepId;
  title: string;
  /** One line: what this step does for you. */
  blurb: string;
  task: string;
  /** Model servers in order of preference; the first available is used. */
  servers: string[];
  optional: boolean;
  defaultOn: (kind: Kind) => boolean;
  produces: "image" | "mesh";
  /** For each input role, earlier steps to take it from, nearest first. */
  from: Record<string, StepId[]>;
  /** Settings that differ from the model's own defaults. */
  params?: Record<string, unknown>;
  /** How long it usually takes (from the verified barrel run). */
  typical: string;
  /** Uses a big model: runs one at a time with the other heavy steps. */
  heavy?: boolean;
}

const always = () => true;
const never = () => false;
const MESH_CHAIN: StepId[] = ["normals", "paint", "gamemesh", "cleanup", "detail", "shape"];

export const STEPS: StepDef[] = [
  {
    id: "concept",
    title: "Concept image",
    blurb: "A clean reference picture of the object. Everything after this is built from it.",
    task: "text-to-image",
    servers: ["qwen-image", "sdxl-local"],
    optional: false,
    defaultOn: always,
    produces: "image",
    from: {},
    typical: "about 3 min (SDXL: under 1 min)",
    heavy: true,
  },
  {
    id: "cutout",
    title: "Cut out background",
    blurb: "Removes the background so the 3D model gets only the object.",
    task: "image-to-image",
    servers: ["birefnet"],
    optional: false,
    defaultOn: always,
    produces: "image",
    from: { image: ["concept"] },
    typical: "about 15 s",
  },
  {
    id: "shape",
    title: "3D shape",
    blurb: "Builds the 3D shape from the cut-out picture (no colours yet).",
    task: "image-to-3d",
    servers: ["hunyuan3d21", "triposg"],
    optional: false,
    defaultOn: always,
    produces: "mesh",
    from: { image: ["cutout", "concept"] },
    typical: "about 2 min",
    heavy: true,
  },
  {
    id: "detail",
    title: "Extra detail",
    blurb: "Rebuilds the surface finer with Hi3D. Worth it for hero assets; skip for quick props.",
    task: "3d-refine",
    servers: ["hi3d"],
    optional: true,
    defaultOn: never,
    produces: "mesh",
    from: { mesh: ["shape"], image: ["cutout", "concept"] },
    typical: "about 5 min",
    heavy: true,
  },
  {
    id: "cleanup",
    title: "Clean up",
    blurb: "Removes loose fragments (and optionally a ground slab) left by the 3D model.",
    task: "3d-cleanup",
    servers: ["mesh-cleanup"],
    optional: true,
    defaultOn: never,
    produces: "mesh",
    from: { mesh: ["detail", "shape"] },
    typical: "about 30 s",
  },
  {
    id: "gamemesh",
    title: "Game-ready mesh",
    blurb: "Rebuilds clean, even geometry (QuadriFlow, ~40k triangles) that games handle well.",
    task: "3d-retopo",
    servers: ["game-mesh"],
    optional: true,
    defaultOn: always,
    produces: "mesh",
    from: { mesh: ["cleanup", "detail", "shape"] },
    params: { method: "quadriflow", faces: 20000 },
    typical: "about 30 s",
  },
  {
    id: "paint",
    title: "Paint textures",
    blurb: "Paints colour and material textures onto the mesh, matching the concept image.",
    task: "3d-paint",
    servers: ["trellis2-paint"],
    optional: false,
    defaultOn: always,
    produces: "mesh",
    from: { mesh: ["gamemesh", "cleanup", "detail", "shape"], image: ["cutout", "concept"] },
    typical: "about 2 min",
    heavy: true,
  },
  {
    id: "normals",
    title: "Bake fine detail",
    blurb: "Copies small surface detail from the detailed mesh into a normal map on the game mesh.",
    task: "3d-bake-normals",
    servers: ["game-mesh"],
    optional: true,
    defaultOn: never,
    produces: "mesh",
    from: { high: ["cleanup", "detail", "shape"], low: ["paint"] },
    typical: "about 10 s",
  },
  {
    id: "rig",
    title: "Skeleton (rig)",
    blurb: "Adds bones and skin weights so the model can move. For characters and creatures.",
    task: "3d-to-rig",
    servers: ["skintokens"],
    optional: true,
    defaultOn: (kind) => kind === "character" || kind === "creature",
    produces: "mesh",
    from: { mesh: MESH_CHAIN },
    typical: "about 1 min",
  },
  {
    id: "animate",
    title: "Test animation",
    blurb: "A quick motion to check the rig (bend test, turntable or a moving part).",
    task: "rig-motion",
    servers: ["blender-animation"],
    optional: true,
    defaultOn: never,
    produces: "mesh",
    from: { rig: ["rig"] },
    params: { preset: "weight-check" },
    typical: "about 30 s",
  },
];

export const stepById = (id: string) => STEPS.find((step) => step.id === id);

/** Final result candidates for Godot, nearest the end first. */
export const FINAL_CHAIN: StepId[] = ["animate", "rig", ...MESH_CHAIN];

export const KINDS: { id: Kind; label: string; hint: string; purpose: string }[] = [
  { id: "prop", label: "Prop", hint: "Barrels, rocks, furniture", purpose: "Object reference" },
  { id: "mechanical", label: "Mechanical", hint: "Vehicles, machines, doors", purpose: "Mechanical prop" },
  { id: "character", label: "Character", hint: "People, humanoids", purpose: "Humanoid for rigging" },
  { id: "creature", label: "Creature", hint: "Animals, monsters", purpose: "Creature for rigging" },
];

// ------------------------------------------------------------------ lookups

export interface World {
  doc: GameAsset;
  jobs: ReadonlyMap<string, Job>;
  asset: (id: string) => Asset | undefined;
  servers: Server[];
}

export const stepState = (doc: GameAsset, id: string): StepState => doc.steps[id] ?? {};

export function included(doc: GameAsset, step: StepDef): boolean {
  if (!step.optional) return true;
  return stepState(doc, step.id).include ?? step.defaultOn(doc.kind);
}

export const PENDING = new Set(["queued", "waiting_model", "running"]);

/** The servers able to run a step's task, recommended first. */
export function candidates(step: StepDef, servers: Server[]): { server: Server; task: Task }[] {
  return step.servers.flatMap((id) => {
    const server = servers.find((item) => item.id === id);
    const task = server?.tasks.find((item) => item.task === step.task);
    return server && task ? [{ server, task }] : [];
  });
}

export function chosen(world: World, step: StepDef) {
  const options = candidates(step, world.servers);
  const wanted = stepState(world.doc, step.id).server;
  return options.find((option) => option.server.id === wanted) ?? options[0];
}

/** Jobs of a step, newest first. */
export function stepJobs(world: World, step: StepDef): Job[] {
  return (stepState(world.doc, step.id).jobs ?? [])
    .map((id) => world.jobs.get(id))
    .filter((job): job is Job => job !== undefined)
    .reverse();
}

export interface Result {
  asset: Asset;
  /** The job that made it; undefined for a result added by hand. */
  job?: Job;
}

/** Live results of a step, newest first. Deleted assets are left out. */
export function results(world: World, step: StepDef): Result[] {
  const made: Result[] = stepJobs(world, step)
    .filter((job) => job.status === "succeeded")
    .flatMap((job) =>
      job.outputs.flatMap((id) => {
        const asset = world.asset(id);
        return asset && !asset.deleted_at ? [{ asset, job }] : [];
      }),
    );
  const added: Result[] = [...(stepState(world.doc, step.id).extra ?? [])]
    .reverse()
    .flatMap((id) => {
      const asset = world.asset(id);
      return asset && !asset.deleted_at ? [{ asset }] : [];
    });
  // Newest first across both lists, by asset id (time-ordered).
  return [...made, ...added].sort((a, b) => (a.asset.id < b.asset.id ? 1 : -1));
}

/** The result that feeds the next step: the one picked, else the newest. */
export function picked(world: World, step: StepDef): Result | undefined {
  const list = results(world, step);
  const pick = stepState(world.doc, step.id).pick;
  return list.find((item) => item.asset.id === pick) ?? list[0];
}

/** Which earlier step feeds each input role (included steps only). */
export function sources(world: World, step: StepDef): Record<string, StepDef | undefined> {
  return Object.fromEntries(
    Object.entries(step.from).map(([role, ids]) => [
      role,
      ids.map(stepById).find((source) => source && included(world.doc, source)),
    ]),
  );
}

/** The input assets for running a step now, or the step still missing one. */
export function inputsNow(
  world: World,
  step: StepDef,
): { inputs: Record<string, string> } | { missing: StepDef | null } {
  const inputs: Record<string, string> = {};
  for (const [role, source] of Object.entries(sources(world, step))) {
    if (!source) return { missing: null };
    const result = picked(world, source);
    if (!result) return { missing: source };
    inputs[role] = result.asset.id;
  }
  return { inputs };
}

/** True when the picked result was made from different inputs than the
 * earlier steps now provide (an earlier pick changed or was redone). */
export function isStale(world: World, step: StepDef): boolean {
  const result = picked(world, step);
  if (!result?.job) return false;
  const now = inputsNow(world, step);
  if (!("inputs" in now)) return false;
  return Object.entries(now.inputs).some(([role, id]) => result.job?.inputs[role] !== id);
}

export type Status = "off" | "running" | "failed" | "stale" | "done" | "ready" | "blocked" | "nomodel";

export function status(world: World, step: StepDef): Status {
  if (!included(world.doc, step)) return "off";
  const jobs = stepJobs(world, step);
  if (jobs.some((job) => PENDING.has(job.status))) return "running";
  const result = picked(world, step);
  if (result) return isStale(world, step) ? "stale" : "done";
  if (!chosen(world, step)) return "nomodel";
  if (jobs[0]?.status === "failed") return "failed";
  if (step.id === "concept") return "ready";
  return "inputs" in inputsNow(world, step) ? "ready" : "blocked";
}

/** The final model to send to Godot. */
export function finalResult(world: World): { step: StepDef; result: Result } | undefined {
  for (const id of FINAL_CHAIN) {
    const step = stepById(id);
    if (!step || !included(world.doc, step)) continue;
    const result = picked(world, step);
    if (result) return { step, result };
  }
  return undefined;
}

/** A picture to represent the game asset: the cut-out, else the concept. */
export function coverImage(world: World): Asset | undefined {
  for (const id of ["cutout", "concept"] as const) {
    const step = stepById(id);
    const result = step && picked(world, step);
    if (result) return result.asset;
  }
  return undefined;
}

/** Settings for a step: model defaults, our overrides, then the user's. */
export function paramsFor(world: World, step: StepDef, task: Task): Record<string, unknown> {
  const schema = task.params_schema as { properties?: Record<string, { default?: unknown }> };
  const defaults = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, prop]) => [name, prop.default]),
  );
  // Only names this model knows: switching models must not send foreign settings.
  const known = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).filter(([name]) => name in defaults));
  return {
    ...defaults,
    ...known(step.params ?? {}),
    ...known(stepState(world.doc, step.id).params ?? {}),
  };
}

export function kindPurpose(kind: Kind) {
  return KINDS.find((item) => item.id === kind)?.purpose ?? "Object reference";
}
