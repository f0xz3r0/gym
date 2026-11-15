// Scene plans: one game scene described in words (what it is, its gameplay loop, how it is won, the controls),
// concept images, and the list of game assets it needs. Each planned asset can become a game asset; the plan keeps
// the link and shows its progress. Stored by pipeline_api.py in <data_dir>/pipeline/scenes.json.
import { signal } from "@preact/signals";

import { api, ApiError } from "../api/client";
import { assetById, putAsset } from "../state/store";
import { Conflict, type Kind, type RealSize } from "./api";
import type { ReferenceMode } from "./steps";
import { createDoc, docs, setReference, setReferenceMode, update } from "./state";

export interface Concept {
  /** library asset id of the picture */
  asset: string;
  /** what the picture shows or is for: "mood", "the street from the truck", "garbage man front" */
  note: string;
}

export interface PlannedAsset {
  /** stable row id within the plan */
  key: string;
  name: string;
  kind: Kind;
  /** what it looks like: becomes the game asset's idea */
  idea: string;
  /** what it does in the gameplay, or "scenery" */
  role: string;
  /** how many copies the scene places */
  count: number;
  /** real size in metres [width, height, depth], 0 = free; passed to the game asset (scaled on export) */
  size: RealSize;
  /** a concept image of the plan (library asset id) to draw this asset from */
  concept: string | null;
  /** how the game asset uses that picture (see StepState.referenceMode) */
  mode: ReferenceMode;
  /** the game asset made from this row */
  game_asset: string | null;
}

export interface Scene {
  id: string;
  rev: number;
  name: string;
  description: string;
  /** the gameplay loop, one beat per entry, in order */
  loop: string[];
  win: string;
  controls: string;
  notes: string;
  concepts: Concept[];
  assets: PlannedAsset[];
  godot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Suggestion {
  name: string;
  kind: Kind;
  idea: string;
  role: string;
  count: number;
  concept: string | null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const detail = ((await response.json()) as { detail?: unknown }).detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = "Please check the form: " + JSON.stringify(detail[0]);
    } catch {
      // not JSON: keep the status line
    }
    if (response.status === 409) throw new Conflict(message);
    throw new ApiError(message);
  }
  return (await response.json()) as T;
}

const sceneApi = {
  list: () => call<Scene[]>("GET", "/api/pipeline/scenes"),
  get: (id: string) => call<Scene>("GET", `/api/pipeline/scenes/${id}`),
  create: (name: string, description: string) => call<Scene>("POST", "/api/pipeline/scenes", { name, description }),
  save: (scene: Scene) =>
    call<Scene>("PUT", `/api/pipeline/scenes/${scene.id}`, {
      rev: scene.rev,
      name: scene.name,
      description: scene.description,
      loop: scene.loop,
      win: scene.win,
      controls: scene.controls,
      notes: scene.notes,
      concepts: scene.concepts,
      assets: scene.assets,
      godot: scene.godot,
    }),
  remove: (id: string) => call<{ deleted: boolean }>("DELETE", `/api/pipeline/scenes/${id}`),
  suggest: (id: string) =>
    call<{ assets: Suggestion[]; images_seen: number; seconds: number }>("POST", `/api/pipeline/scenes/${id}/suggest`),
};

export const scenes = signal<ReadonlyMap<string, Scene>>(new Map());
export const scenesLoaded = signal(false);

function put(scene: Scene) {
  const next = new Map(scenes.value);
  next.set(scene.id, normalise(scene));
  scenes.value = next;
}

/** Fill fields an older or hand-edited plan may lack. */
function normalise(scene: Scene): Scene {
  return {
    ...scene,
    loop: scene.loop ?? [],
    concepts: scene.concepts ?? [],
    assets: (scene.assets ?? []).map((row) => ({
      key: row.key || newKey(),
      name: row.name ?? "",
      kind: row.kind ?? "prop",
      idea: row.idea ?? "",
      role: row.role ?? "",
      count: row.count ?? 1,
      size: row.size ?? [0, 0, 0],
      concept: row.concept ?? null,
      mode: row.mode ?? "redraw",
      game_asset: row.game_asset ?? null,
    })),
  };
}

export const newKey = () => Math.random().toString(36).slice(2, 10);

export async function loadScenes() {
  const list = await sceneApi.list();
  scenes.value = new Map(list.map((scene) => [scene.id, normalise(scene)]));
  scenesLoaded.value = true;
}

export async function loadScene(id: string) {
  put(await sceneApi.get(id));
}

export async function createScene(name: string, description: string) {
  const scene = await sceneApi.create(name, description);
  put(scene);
  return scene;
}

export async function deleteScene(id: string) {
  await sceneApi.remove(id);
  const next = new Map(scenes.value);
  next.delete(id);
  scenes.value = next;
}

/** Change a plan and save it; if another window saved first, reload and apply the change again. */
export async function updateScene(id: string, change: (scene: Scene) => void): Promise<Scene> {
  for (let attempt = 0; ; attempt++) {
    const current = scenes.value.get(id) ?? normalise(await sceneApi.get(id));
    const next = structuredClone(current);
    change(next);
    try {
      const saved = await sceneApi.save(next);
      put(saved);
      return saved;
    } catch (error) {
      if (!(error instanceof Conflict) || attempt > 1) throw error;
      put(await sceneApi.get(id));
    }
  }
}

export const suggestAssets = (id: string) => sceneApi.suggest(id);

/** Upload pictures to the library and add them to the plan's concepts. */
export async function addConceptFiles(id: string, files: File[]) {
  const added: Concept[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const asset = await api.upload(file, file.name.replace(/\.[^.]+$/, ""));
    putAsset(asset);
    added.push({ asset: asset.id, note: "" });
  }
  if (added.length) await updateScene(id, (scene) => void scene.concepts.push(...added));
  return added.length;
}

/** Load library entries the plan refers to that the page has not seen yet. */
export function ensureAssets(ids: Iterable<string | null | undefined>) {
  for (const id of ids) {
    if (!id || assetById(id) || asking.has(id)) continue;
    asking.add(id);
    void api
      .asset(id)
      .then(putAsset)
      .catch(() => undefined)
      .finally(() => asking.delete(id));
  }
}
const asking = new Set<string>();

/** Turn a planned row into a game asset (with its concept picture as the reference) and link it. */
export async function makeGameAsset(scene: Scene, row: PlannedAsset) {
  const existing = row.game_asset ? docs.value.get(row.game_asset) : undefined;
  if (existing) return existing;
  const idea = [row.idea.trim() || row.name.trim(), sizeWords(row.size)].filter(Boolean).join(" ");
  let doc = await createDoc(row.name.trim() || "Untitled", row.kind, idea);
  if (row.size.some((v) => v > 0))
    doc = await update(doc.id, (next) => void (next.godot = { ...next.godot, size: [...row.size] as RealSize }));
  if (row.concept) {
    doc = await setReferenceMode(doc, row.mode);
    doc = await setReference(doc, row.concept);
  }
  await updateScene(scene.id, (next) => {
    const target = next.assets.find((item) => item.key === row.key);
    if (target) target.game_asset = doc.id;
  });
  return doc;
}

/** "Real size: 2 m wide, 1.2 m tall, 0.08 m deep." for the description, so the concept gets the proportions. */
export function sizeWords(size: RealSize): string {
  const parts = ["wide", "tall", "deep"].flatMap((word, i) => ((size[i] ?? 0) > 0 ? [`${size[i]} m ${word}`] : []));
  return parts.length ? `Real size: ${parts.join(", ")}.` : "";
}

/** The plan as text: a brief to paste into a chat, a design doc or a Godot project's README. */
export function sceneBrief(scene: Scene): string {
  const lines = [`# ${scene.name}`, "", scene.description.trim()];
  const loop = scene.loop.filter((beat) => beat.trim());
  if (loop.length) lines.push("", "## Gameplay loop", ...loop.map((beat, i) => `${i + 1}. ${beat.trim()}`));
  if (scene.win.trim()) lines.push("", "## Win condition", scene.win.trim());
  if (scene.controls.trim()) lines.push("", "## Controls", scene.controls.trim());
  if (scene.notes.trim()) lines.push("", "## Notes", scene.notes.trim());
  if (scene.assets.length) {
    lines.push("", "## Assets", "", "| Asset | Kind | Count | Size (m) | Role | Look |", "|---|---|---|---|---|---|");
    for (const row of scene.assets)
      lines.push(
        `| ${row.name} | ${row.kind} | ${row.count} | ${row.size.some((v) => v > 0) ? row.size.map((v) => v || "–").join(" × ") : ""} | ${row.role} | ${row.idea.replace(/\s+/g, " ")} |`,
      );
  }
  const notes = scene.concepts.filter((c) => c.note.trim());
  if (notes.length) lines.push("", "## Concept images", ...notes.map((c) => `- ${c.note.trim()}`));
  return lines.join("\n") + "\n";
}
