// Small builders for game assets, jobs and library assets, shaped like the studio's API returns them.
import type { Asset, Job } from "../src/api/client";
import type { GameAsset, StepState } from "../src/pipeline/api";
import type { Scene } from "../src/pipeline/scenes";
import type { World } from "../src/pipeline/steps";

export const asset = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, mime: "image/png", meta: {}, tags: [], deleted_at: null, size_bytes: 1, ...extra }) as unknown as Asset;

export const job = (id: string, outputs: string[], inputs: Record<string, string> = {}): Job =>
  ({ id, status: "succeeded", outputs, inputs, version: 1 }) as unknown as Job;

export const doc = (id: string, steps: Record<string, StepState>, kind = "prop"): GameAsset =>
  ({ id, rev: 1, name: id, kind, idea: "", steps, godot: {} }) as unknown as GameAsset;

export const scene = (id: string, concepts: string[], rowConcepts: (string | null)[]): Scene =>
  ({
    id, rev: 1, name: id, description: "", loop: [], win: "", controls: "", notes: "", godot: {},
    created_at: "", updated_at: "",
    concepts: concepts.map((asset) => ({ asset, note: "" })),
    assets: rowConcepts.map((concept, k) => ({
      key: `r${k}`, name: "", kind: "prop", idea: "", role: "", count: 1, size: [0, 0, 0], concept, mode: "pose",
      game_asset: null,
    })),
  }) as unknown as Scene;

export function world(d: GameAsset, jobs: Job[], assets: Asset[]): World {
  const byId = new Map(assets.map((a) => [a.id, a]));
  return { doc: d, jobs: new Map(jobs.map((j) => [j.id, j])), asset: (id) => byId.get(id), servers: [] };
}
