// Bulk clean-up of a game asset's results. Deleting is permanent in the studio (the library entry goes and its file
// is removed when nothing else uses it), so what is in use is protected: every step's picked result, and every input
// a picked result was made from (its job's inputs).
import { api, type Asset } from "../api/client";
import { assetById, jobs, mergeJob, putAsset } from "../state/store";
import type { GameAsset } from "./api";
import { allJobIds, docs, loadDocs, update, worldOf } from "./state";
import { included, picked, results, type StepDef, STEPS, type World } from "./steps";

/** Results that must stay: the picks and what they were made from. */
export function protectedIds(world: World): Set<string> {
  const keep = new Set<string>();
  for (const step of STEPS) {
    if (!included(world.doc, step)) continue;
    const result = picked(world, step);
    if (!result) continue;
    keep.add(result.asset.id);
    for (const value of Object.values(result.job?.inputs ?? {}))
      if (typeof value === "string") keep.add(value);
  }
  return keep;
}

/** Everything in use by any game asset: every pick, its inputs, and the files attached to those (a picked walk's
 * review film and contact sheet). The library's bulk delete leaves these alone. */
export function protectedEverywhere(): Set<string> {
  const keep = new Set<string>();
  for (const doc of docs.value.values()) {
    const world = worldOf(doc);
    for (const id of protectedIds(world)) {
      keep.add(id);
      const asset = world.asset(id);
      if (asset) attachments(asset).forEach((a) => keep.add(a));
    }
    for (const step of STEPS) {
      const reference = world.doc.steps[step.id]?.reference;
      if (reference) keep.add(reference);            // a picked reference picture or input video
    }
  }
  return keep;
}

/** Load every game asset, every job of theirs and the assets those jobs made (the library page may not have them):
 * protection is only as good as this. Resolves when all are in. */
export async function loadForProtection(): Promise<void> {
  await loadDocs();
  const ids = [...docs.value.values()].flatMap(allJobIds).filter((id) => !jobs.value.has(id));
  for (let k = 0; k < ids.length; k += 8)
    await Promise.all(ids.slice(k, k + 8).map((id) => api.job(id).then(mergeJob).catch(() => undefined)));
  const outputs = [...docs.value.values()].flatMap((doc) => [
    ...allJobIds(doc).flatMap((id) => jobs.value.get(id)?.outputs ?? []),
    ...Object.values(doc.steps).flatMap((s) => [...(s.extra ?? []), s.reference ?? ""]),
  ]).filter((id) => id && !assetById(id));
  for (let k = 0; k < outputs.length; k += 8)
    await Promise.all(outputs.slice(k, k + 8).map((id) => api.asset(id).then(putAsset).catch(() => undefined)));
}

/** Delete library assets (and their attachments), skipping what is in use anywhere, and take them off every game
 * asset's steps. */
export async function deleteAssets(
  list: Asset[],
  progress?: (done: number, total: number) => void,
): Promise<{ deleted: number; skipped: number }> {
  await loadForProtection();                 // never decide what is safe on half-loaded data
  const keep = protectedEverywhere();
  const todo = list.filter((asset) => !keep.has(asset.id));
  const gone = new Set<string>();
  let k = 0;
  for (const asset of todo) {
    progress?.(k++, todo.length);
    for (const id of [...attachments(asset).filter((a) => !keep.has(a)), asset.id]) {
      try {
        putAsset(await api.deleteAsset(id));
        gone.add(id);
      } catch {
        /* in use by a running job, or already gone */
      }
    }
  }
  progress?.(todo.length, todo.length);
  for (const doc of docs.value.values()) {
    const world = worldOf(doc);
    const touched = STEPS.some((step) => {
      const state = doc.steps[step.id];
      return state && ((state.extra ?? []).some((id) => gone.has(id)) || (state.jobs ?? []).some((j) =>
        (world.jobs.get(j)?.outputs ?? []).some((o) => gone.has(o))));
    });
    if (touched) await dropFromSteps(doc, gone);
  }
  return { deleted: todo.filter((asset) => gone.has(asset.id)).length, skipped: list.length - todo.length };
}

async function dropFromSteps(doc: GameAsset, gone: Set<string>) {
  const world = worldOf(doc);
  await update(doc.id, (next) => {
    for (const step of STEPS) {
      const state = next.steps[step.id];
      if (!state) continue;
      if (state.extra) state.extra = state.extra.filter((id) => !gone.has(id));
      if (state.jobs)
        state.jobs = state.jobs.filter((id) => {
          const job = world.jobs.get(id);
          return !job || job.status !== "succeeded" || job.outputs.length === 0 || job.outputs.some((o) => !gone.has(o));
        });
      if (state.pick && gone.has(state.pick)) state.pick = null;
    }
  });
}

/** Files that belong to one result only: its review film, full clip, sheets (meta keys ending in _asset). */
export function attachments(asset: Asset): string[] {
  return Object.entries(asset.meta ?? {})
    .filter(([key, value]) => key.endsWith("_asset") && typeof value === "string")
    .map(([, value]) => value as string);
}

export interface Removable {
  step: StepDef;
  asset: Asset;
}

/** Every result of the asset's steps that could go, newest first per step. */
export function removable(world: World): Removable[] {
  const keep = protectedIds(world);
  return STEPS.flatMap((step) =>
    results(world, step).filter((r) => !keep.has(r.asset.id)).map((r) => ({ step, asset: r.asset })),
  );
}

export const megabytes = (items: { asset: Asset }[]) =>
  items.reduce((sum, item) => sum + (item.asset.size_bytes ?? 0), 0) / 2 ** 20;

/** Delete these results (and their attachments) and take them off their steps. Protected ones are skipped. */
export async function deleteResults(
  doc: GameAsset,
  items: Removable[],
  progress?: (done: number, total: number) => void,
): Promise<{ deleted: number; skipped: number }> {
  const keep = protectedIds(worldOf(doc));
  const todo = items.filter((item) => !keep.has(item.asset.id));
  const gone = new Set<string>();
  let k = 0;
  for (const item of todo) {
    progress?.(k++, todo.length);
    for (const id of [...attachments(item.asset), item.asset.id]) {
      try {
        putAsset(await api.deleteAsset(id));
        gone.add(id);
      } catch {
        /* in use by a running job, or already gone: left as it is */
      }
    }
  }
  progress?.(todo.length, todo.length);
  await dropFromSteps(doc, gone);
  return { deleted: todo.filter((item) => gone.has(item.asset.id)).length, skipped: items.length - todo.length };
}
