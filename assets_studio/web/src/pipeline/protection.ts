// What a delete must leave alone. Pure: reads game-asset documents, jobs, assets and scene plans, changes nothing,
// so it can be tested without the studio (tests/protection.test.ts).
//
// Rules (finding 18, 2026-11-16): every step's pick as stored (on or off, loaded or not), the result that feeds the
// next step on included steps, what those were made from, each step's chosen reference, the files attached to those,
// and every picture a scene plan refers to (its concept pictures and each planned asset's concept).
import type { Asset } from "../api/client";
import type { GameAsset } from "./api";
import type { Scene } from "./scenes";
import { included, picked, STEPS, type World } from "./steps";

/** Files that belong to one result only: its review film, full clip, sheets (meta keys ending in _asset). */
export function attachments(asset: Asset): string[] {
  return Object.entries(asset.meta ?? {})
    .filter(([key, value]) => key.endsWith("_asset") && typeof value === "string")
    .map(([, value]) => value as string);
}

/** One game asset's results in use, with what they were made from and their attachments. */
export function protectedIds(world: World): Set<string> {
  const keep = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || keep.has(id)) return;
    keep.add(id);
    const asset = world.asset(id);
    if (asset) attachments(asset).forEach((a) => keep.add(a));
  };
  const inputsOf = (inputs: Record<string, unknown> | undefined) => {
    for (const value of Object.values(inputs ?? {})) if (typeof value === "string") add(value);
  };
  for (const step of STEPS) {
    const state = world.doc.steps[step.id];
    // the pick as stored: whether or not the step is on, and whether or not its result or job is loaded
    if (state?.pick) {
      add(state.pick);
      for (const id of state.jobs ?? []) {
        const job = world.jobs.get(id);
        if (job?.outputs.includes(state.pick)) inputsOf(job.inputs);
      }
    }
    add(state?.reference);                       // a chosen reference picture or input video
    if (!included(world.doc, step)) continue;
    const result = picked(world, step);          // with no pick stored: the newest, which feeds the next step
    if (!result) continue;
    add(result.asset.id);
    inputsOf(result.job?.inputs);
  }
  return keep;
}

/** Every picture a scene plan refers to: its concept pictures and each planned asset's concept. */
export function sceneIds(plans: Iterable<Scene>): Set<string> {
  const keep = new Set<string>();
  for (const scene of plans) {
    for (const concept of scene.concepts) if (concept.asset) keep.add(concept.asset);
    for (const row of scene.assets) if (row.concept) keep.add(row.concept);
  }
  return keep;
}

/** Everything in use by any game asset or scene plan. */
export function protectedAll(worlds: Iterable<World>, plans: Iterable<Scene>): Set<string> {
  const keep = sceneIds(plans);
  for (const world of worlds) for (const id of protectedIds(world)) keep.add(id);
  return keep;
}

/** Ids of the library assets and jobs the documents refer to: what has to be loaded before deciding anything. */
export function referencedIds(doc: GameAsset): { jobs: string[]; assets: string[] } {
  const states = Object.values(doc.steps);
  return {
    jobs: states.flatMap((s) => s.jobs ?? []),
    assets: states.flatMap((s) => [...(s.extra ?? []), s.reference ?? "", s.pick ?? ""]).filter(Boolean),
  };
}
