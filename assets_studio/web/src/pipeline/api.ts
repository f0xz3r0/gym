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

export interface GodotExportRecord {
  res_path: string;
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
  }) =>
    call<Omit<GodotExportRecord, "asset">>("POST", "/api/godot/export", body),
  reveal: (path: string) => call<{ shown: boolean }>("POST", "/api/godot/reveal", { path }),
};
