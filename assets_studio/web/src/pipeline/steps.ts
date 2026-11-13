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
  | "repair"
  | "normals"
  | "rig"
  | "animrig"
  | "motion"
  | "textmotion"
  | "mocap"
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
  /** An input the user picks (from the library or an upload), not an earlier step: kept in the step's reference. */
  userInput?: { role: string; kind: "image" | "video"; label: string };
  /** Settings taken from the game asset itself (e.g. its name), before the user's own. */
  paramsFrom?: (doc: GameAsset) => Record<string, unknown>;
}

const always = () => true;
const never = () => false;
const MESH_CHAIN: StepId[] = ["normals", "repair", "paint", "gamemesh", "cleanup", "detail", "shape"];

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
    servers: ["hunyuan-paint21", "trellis2-paint"],
    optional: false,
    defaultOn: always,
    produces: "mesh",
    from: { mesh: ["gamemesh", "cleanup", "detail", "shape"], image: ["cutout", "concept"] },
    typical: "about 2 min",
    heavy: true,
  },
  {
    id: "repair",
    title: "Repair texture",
    blurb:
      "Opens Blender with the painted model and StableGen: fix a blotch, a seam or a wrong colour, press Bake " +
      "Textures, then \"Send back to Studio\" in the Studio tab. Closing Blender without sending changes nothing.",
    task: "3d-texture-repair",
    servers: ["texture-repair"],
    optional: true,
    defaultOn: never,
    produces: "mesh",
    from: { mesh: ["paint"] },
    typical: "as long as you work in Blender (it opens in about 20 s)",
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
    from: { high: ["cleanup", "detail", "shape"], low: ["repair", "paint"] },
    typical: "about 10 s",
  },
  {
    id: "rig",
    title: "Skeleton (rig)",
    blurb:
      "Adds bones and skin weights so a prop or machine can move (doors, wheels, arms). Characters and creatures " +
      "use the Animation rig step instead.",
    task: "3d-to-rig",
    servers: ["skintokens", "unirig"],
    optional: true,
    defaultOn: (kind) => kind === "prop" || kind === "mechanical",
    produces: "mesh",
    from: { mesh: MESH_CHAIN },
    typical: "about 1 min",
  },
  {
    id: "animrig",
    title: "Animation rig (auto-rig)",
    blurb:
      "Animation pipeline v2.0, step 1: video2rig's auto-rig gives the model its own skeleton (UniRig, checked on " +
      "the mesh) and skin, in a relaxed start pose. Look at the skeleton and the test poses before the motion step.",
    task: "ai-video-rig",
    servers: ["video2rig"],
    optional: true,
    defaultOn: (kind) => kind === "creature" || kind === "character",
    produces: "mesh",
    from: { mesh: ["normals", "repair", "paint", "gamemesh", "cleanup", "detail", "shape"] },
    paramsFrom: (doc) => ({ creature: doc.name }),
    typical: "about 3 min",
    heavy: true,
  },
  {
    id: "motion",
    title: "Motion from AI video",
    blurb:
      "Animation pipeline v2.0, step 2: MiniMax-H3 films the rigged model from the front and the side, both views " +
      "are checked against each other, and the move is fitted to the rig as a looping, in-place game animation. " +
      "Running it approves the rig.",
    task: "ai-video-motion",
    servers: ["video2rig"],
    optional: true,
    defaultOn: (kind) => kind === "creature" || kind === "character",
    produces: "mesh",
    from: { rig: ["animrig"] },
    paramsFrom: (doc) => ({ creature: doc.name }),
    typical: "about 30 min the first time (the reader trains once per creature), then about 12 min per move",
    heavy: true,
  },
  {
    id: "textmotion",
    title: "Motion from text (Kimodo)",
    blurb:
      "Type what the character does (\"walks forward continuously, arms swinging\"): NVIDIA Kimodo makes the " +
      "motion in seconds and it is put on this character's own rig, as a game loop. Humanoids only.",
    task: "ai-text-motion",
    servers: ["kimodo"],
    optional: true,
    defaultOn: (kind) => kind === "character",
    produces: "mesh",
    from: { rig: ["animrig"] },
    typical: "about 1 min (the first time a prompt is used: about 30 s more)",
    heavy: true,
  },
  {
    id: "mocap",
    title: "Motion from real video (MoCapAnything)",
    blurb:
      "Pick a video of a real person or animal doing the move: MoCapAnything reads the motion and puts it on " +
      "this character's rig. Best with one subject, the whole body in view, a steady camera.",
    task: "video-to-motion",
    servers: ["mocapanything"],
    optional: true,
    defaultOn: never,
    produces: "mesh",
    from: { rig: ["animrig"] },
    userInput: { role: "video", kind: "video", label: "Video of the move" },
    params: { output_format: "glb" },
    typical: "a few minutes",
    heavy: true,
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
    from: { rig: ["animrig", "rig"] },
    params: { preset: "weight-check" },
    typical: "about 30 s",
  },
];

export const stepById = (id: string) => STEPS.find((step) => step.id === id);

/** Final result candidates for Godot, nearest the end first. */
export const FINAL_CHAIN: StepId[] = ["motion", "textmotion", "mocap", "animate", "rig", "animrig", ...MESH_CHAIN];

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

/** Concept step: ask for a rig-ready pose. Default on for characters and creatures (they get animated). */
export function rigReady(doc: GameAsset): boolean {
  return stepState(doc, "concept").rigReady ?? (doc.kind === "character" || doc.kind === "creature");
}

/** What a rig-ready concept asks for, by kind (lessons of animation pipeline v2.0, 2026-11-12: the T-pose, empty-
 * handed worker rigged cleanly; a bag in the hand, arms against the chest and a shaggy coat did not). */
export function rigPose(kind: Kind): string {
  // the same pose and camera the prompt writer's rigging purposes ask for (asset_prompt_service.py PURPOSE)
  if (kind === "character")
    return (
      " Exact front view of the full body from head to feet, in a symmetrical neutral A-pose: arms held away from " +
      "the torso at about 45 degrees, hands open and empty, legs apart with clear gaps, feet level. Nothing held or " +
      "carried (no bag, no weapon, no tool), no cape or long loose cloth."
    );
  if (kind === "creature")
    return (
      " Strict side view of the whole animal from nose to tail, standing in a calm neutral pose on all its feet: " +
      "legs straight and clearly apart, front limbs held away from the chest, tail straight out behind. A smooth, " +
      "compact silhouette with a short or sleek coat: no long loose fur or strands, nothing hanging or held."
    );
  return "";
}

/** The concept step's reference picture (asset id), if one is set. */
export function conceptReference(doc: GameAsset): string | undefined {
  return stepState(doc, "concept").reference ?? undefined;
}

/** A step as it runs now: with a reference picture the concept is an image
 * edit (Qwen-Image, picture + description) instead of text-to-image. */
export function effective(world: World, step: StepDef): StepDef {
  if (step.id !== "concept" || !conceptReference(world.doc)) return step;
  return { ...step, task: "image-to-image", servers: ["qwen-image"] };
}

export function chosen(world: World, step: StepDef) {
  const options = candidates(effective(world, step), world.servers);
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
  if (step.userInput) {
    const chosen = stepState(world.doc, step.id).reference;
    if (!chosen) return { missing: null };
    inputs[step.userInput.role] = chosen;
  }
  return { inputs };
}

/** True when the picked result was made from different inputs than the
 * earlier steps now provide (an earlier pick changed or was redone). */
export function isStale(world: World, step: StepDef): boolean {
  const result = picked(world, step);
  if (!result?.job) return false;
  // A concept made from a reference is out of date when the reference changes.
  if (step.id === "concept") return (result.job.inputs.image ?? undefined) !== conceptReference(world.doc);
  const now = inputsNow(world, step);
  if (!("inputs" in now)) return false;
  const job = result.job;
  return Object.entries(now.inputs).some(([role, id]) => usedInput(world, job, role) !== id);
}

/** The asset a job used for an input role. A job queued as part of a chain
 * names the earlier job's output (dependencies) rather than an asset id. */
function usedInput(world: World, job: Job, role: string): string | undefined {
  const direct = job.inputs[role];
  if (direct) return direct;
  const dep = job.dependencies?.[role];
  if (!dep) return undefined;
  return world.jobs.get(dep.job_id)?.outputs[dep.output_index ?? 0];
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
  return sendable(world)[0];
}

const MOTION_STEPS: StepId[] = ["motion", "textmotion", "mocap"];

/** What Send to Godot can send, best first: every motion result (newest first: the one made last is the one you
 * want), then the newest model of the rest of the chain. */
export function sendable(world: World): { step: StepDef; result: Result }[] {
  const out: { step: StepDef; result: Result }[] = [];
  for (const id of FINAL_CHAIN) {
    const step = stepById(id);
    if (!step || !included(world.doc, step)) continue;
    const result = picked(world, step);
    if (result) out.push({ step, result });
  }
  const motions = out.filter((item) => MOTION_STEPS.includes(item.step.id));
  motions.sort((a, b) => (a.result.asset.id < b.result.asset.id ? 1 : -1));
  const rest = out.filter((item) => !MOTION_STEPS.includes(item.step.id)).slice(0, 1);
  return [...motions, ...rest];
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
    ...known(step.paramsFrom?.(world.doc) ?? {}),
    ...known(stepState(world.doc, step.id).params ?? {}),
  };
}

export function kindPurpose(kind: Kind) {
  return KINDS.find((item) => item.id === kind)?.purpose ?? "Object reference";
}
