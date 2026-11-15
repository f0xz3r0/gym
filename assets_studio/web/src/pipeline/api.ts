// Pipeline documents and Godot export (served by pipeline_api.py beside the studio).
import { ApiError } from "../api/client";

export type Kind = "prop" | "character" | "creature" | "mechanical";

export interface StepState {
  /** Studio jobs started for this step, oldest first. */
  jobs?: string[];
  /** Results added by hand (upload or library), oldest first. */
  extra?: string[];
  /** The result chosen to feed the next step; newest result when unset. */
  pick?: string | null;
  /** Optional steps: on or off. Unset follows the kind's default. */
  include?: boolean;
  /** Model chosen for this step; unset = recommended. */
  server?: string;
  params?: Record<string, unknown>;
  /** Concept step only: a picture (asset id) to draw the concept from. */
  reference?: string | null;
  /** Concept step only, with a reference: "as-is" uses the picture itself as the concept (nothing generated),
   * "pose" keeps the picture and only re-poses it for 3D modelling (fixed prompt, no description needed),
   * "redraw" redraws it following the description. Unset = "pose". */
  referenceMode?: "as-is" | "pose" | "redraw";
  /** Concept step only: ask for a pose the auto-rig handles (T-pose, empty hands, smooth silhouette). */
  rigReady?: boolean;
}

/** Real size in metres: [width, height, depth], 0 = free (real_size.py). */
export type RealSize = [number, number, number];
export type SizeMode = "uniform" | "stretch";
export type Pivot = "bottom-center" | "bottom-left";

export interface SizedResult {
  /** older exports only: a separate sized scene (now the size is built into the GLB) */
  scene?: string | null;
  target: RealSize | null;
  size: RealSize | null;
  measured: RealSize | null;
  mode: SizeMode;
  pivot: Pivot;
  warnings: string[];
  /** with "Square the ends": how much was cut off each end, in mm at the real size */
  squared?: Record<string, number> | null;
}

export interface GodotExportRecord {
  res_path: string;
  /** set when a real size was given: the sized scene and what it measured */
  real_size?: SizedResult | null;
  /** A ready-to-play demo scene written beside an in-place animation (res:// path). */
  demo_scene?: string | null;
  path: string;
  project: string;
  project_name: string;
  exported_at: string;
  asset: string;
}

export interface GameAsset {
  id: string;
  rev: number;
  name: string;
  kind: Kind;
  idea: string;
  prompt: string;
  steps: Record<string, StepState>;
  godot: {
    project?: string;
    folder?: string;
    file_name?: string;
    exports?: GodotExportRecord[];
    /** real size the model is scaled to on export */
    size?: RealSize;
    size_mode?: SizeMode;
    pivot?: Pivot;
    /** cut the rounded tips off both width ends on export, so kit parts meet flush */
    square_ends?: boolean;
  };
  created_at: string;
  updated_at: string;
}

export interface GodotProject {
  path: string;
  name: string;
  godot_ai: boolean;
  saved: boolean;
}

export class Conflict extends ApiError {}

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
      // Not JSON: keep the status line.
    }
    if (response.status === 409) throw new Conflict(message);
    throw new ApiError(message);
  }
  return (await response.json()) as T;
}

export const pipelineApi = {
  list: () => call<GameAsset[]>("GET", "/api/pipeline/assets"),
  get: (id: string) => call<GameAsset>("GET", `/api/pipeline/assets/${id}`),
  create: (body: { name: string; kind: Kind; idea: string }) =>
    call<GameAsset>("POST", "/api/pipeline/assets", body),
  save: (doc: GameAsset) =>
    call<GameAsset>("PUT", `/api/pipeline/assets/${doc.id}`, {
      rev: doc.rev,
      name: doc.name,
      kind: doc.kind,
      idea: doc.idea,
      prompt: doc.prompt,
      steps: doc.steps,
      godot: doc.godot,
    }),
  remove: (id: string) => call<{ deleted: boolean }>("DELETE", `/api/pipeline/assets/${id}`),
  godotProjects: () => call<GodotProject[]>("GET", "/api/godot/projects"),
  addGodotProject: (path: string) => call<GodotProject>("POST", "/api/godot/projects", { path }),
  hideGodotProject: (path: string) => call<{ hidden: boolean }>("POST", "/api/godot/projects/hide", { path }),
  exportToGodot: (body: {
    asset_id: string;
    project: string;
    folder: string;
    file_name: string;
    overwrite: boolean;
    pipeline_asset: string;
    provenance: Record<string, string>;
    size?: RealSize | null;
    size_mode?: SizeMode;
    pivot?: Pivot;
    square_ends?: boolean;
  }) =>
    call<Omit<GodotExportRecord, "asset">>("POST", "/api/godot/export", body),
  reveal: (path: string) => call<{ shown: boolean }>("POST", "/api/godot/reveal", { path }),
};
