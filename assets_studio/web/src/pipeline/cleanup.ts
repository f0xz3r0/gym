// Bulk clean-up: the library's bulk delete and "Clean up" on a game asset. Deleting is permanent in the studio (the
// library entry goes and its file is removed when nothing else uses it), so what is in use anywhere is protected
// (rules in protection.ts): both paths load everything first, refuse to delete when anything failed to load, and
// report the deletes that failed.
import { api, type Asset } from "../api/client";
import { assetById, jobs, mergeJob, putAsset } from "../state/store";
import type { GameAsset } from "./api";
import { attachments, protectedAll, protectedIds, referencedIds } from "./protection";
import { loadScenes, scenes } from "./scenes";
import { docs, loadDocs, update, worldOf } from "./state";
import { results, type StepDef, STEPS, type World } from "./steps";

export { attachments, protectedIds } from "./protection";

/** Everything in use by any game asset or scene plan, from what is loaded now (see loadForProtection). */
export function protectedEverywhere(): Set<string> {
  return protectedAll([...docs.value.values()].map(worldOf), scenes.value.values());
}

/** Load every game asset, every scene plan, every job of theirs and the assets those jobs made (the library page may
 * not have them): protection is only as good as this. Throws, naming what failed, when anything did not load. */
export async function loadForProtection(): Promise<void> {
  const failed: string[] = [];
  await Promise.all([
    loadDocs().catch((error: unknown) => failed.push(`game assets (${String(error)})`)),
    loadScenes().catch((error: unknown) => failed.push(`scene plans (${String(error)})`)),
  ]);
  if (failed.length) throw new Error(`Nothing was deleted: could not load ${failed.join(" and ")}.`);
  const refs = [...docs.value.values()].map(referencedIds);
  const jobIds = [...new Set(refs.flatMap((r) => r.jobs))].filter((id) => !jobs.value.has(id));
  await batched(jobIds, (id) => api.job(id).then(mergeJob), failed);
  const outputs = [
    ...refs.flatMap((r) => r.assets),
    ...refs.flatMap((r) => r.jobs).flatMap((id) => jobs.value.get(id)?.outputs ?? []),
  ];
  const assetIds = [...new Set(outputs)].filter((id) => !assetById(id));
  await batched(assetIds, (id) => api.asset(id).then(putAsset), failed);
  if (failed.length)
    throw new Error(
      `Nothing was deleted: ${failed.length} job or asset record${failed.length === 1 ? "" : "s"} did not load ` +
        `(${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ", …" : ""}). Try again when the studio is up.`,
    );
}

async function batched(ids: string[], load: (id: string) => Promise<unknown>, failed: string[]) {
  for (let k = 0; k < ids.length; k += 8)
    await Promise.all(ids.slice(k, k + 8).map((id) => load(id).catch(() => failed.push(id))));
}

export interface DeleteOutcome {
  deleted: number;
  /** in use, so left alone */
  skipped: number;
  /** deletes the studio refused or that errored: id and the reason */
  failed: { id: string; reason: string }[];
}

/** One line for a toast: what was deleted, kept and what failed. */
export function describeOutcome({ deleted, skipped, failed }: DeleteOutcome, what = "results"): string {
  let text = `Deleted ${deleted} ${what}`;
  if (skipped) text += `; ${skipped} in use were kept`;
  if (failed.length)
    text += `; ${failed.length} could not be deleted (${failed[0]?.reason ?? "unknown"}${failed.length > 1 ? ", …" : ""})`;
  return text + ".";
}

/** Delete these assets with their attachments, leaving out what `keep` protects; collect what failed. */
async function deleteAll(
  list: Asset[],
  keep: Set<string>,
  progress?: (done: number, total: number) => void,
): Promise<{ gone: Set<string>; todo: Asset[]; failed: DeleteOutcome["failed"] }> {
  const todo = list.filter((asset) => !keep.has(asset.id));
  const gone = new Set<string>();
  const failed: DeleteOutcome["failed"] = [];
  let k = 0;
  for (const asset of todo) {
    progress?.(k++, todo.length);
    for (const id of [...attachments(asset).filter((a) => !keep.has(a)), asset.id]) {
      if (gone.has(id)) continue;
      try {
        putAsset(await api.deleteAsset(id));
        gone.add(id);
      } catch (error) {
        failed.push({ id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  progress?.(todo.length, todo.length);
  return { gone, todo, failed };
}

/** Delete library assets (and their attachments), skipping what is in use anywhere, and take them off every game
 * asset's steps. Throws before deleting anything when protection could not be loaded. */
export async function deleteAssets(
  list: Asset[],
  progress?: (done: number, total: number) => void,
): Promise<DeleteOutcome> {
  await loadForProtection();                 // never decide what is safe on half-loaded data
  const { gone, todo, failed } = await deleteAll(list, protectedEverywhere(), progress);
  await dropEverywhere(gone);
  return { deleted: todo.filter((asset) => gone.has(asset.id)).length, skipped: list.length - todo.length, failed };
}

/** Take deleted results off every game asset's steps that listed them. */
async function dropEverywhere(gone: Set<string>) {
  if (!gone.size) return;
  for (const doc of docs.value.values()) {
    const world = worldOf(doc);
    const touched = STEPS.some((step) => {
      const state = doc.steps[step.id];
      return state && ((state.extra ?? []).some((id) => gone.has(id)) || (state.jobs ?? []).some((j) =>
        (world.jobs.get(j)?.outputs ?? []).some((o) => gone.has(o))));
    });
    if (touched) await dropFromSteps(doc, gone);
  }
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

export interface Removable {
  step: StepDef;
  asset: Asset;
}

/** What this game asset protects plus what everything else loaded protects (other game assets, scene plans). */
export function protectedFor(world: World): Set<string> {
  const keep = protectedEverywhere();
  for (const id of protectedIds(world)) keep.add(id);
  return keep;
}

/** Every result of the asset's steps that could go, newest first per step. A preview: deleteResults checks again
 * after loading everything. */
export function removable(world: World): Removable[] {
  const keep = protectedFor(world);
  return STEPS.flatMap((step) =>
    results(world, step).filter((r) => !keep.has(r.asset.id)).map((r) => ({ step, asset: r.asset })),
  );
}

export const megabytes = (items: { asset: Asset }[]) =>
  items.reduce((sum, item) => sum + (item.asset.size_bytes ?? 0), 0) / 2 ** 20;

/** Delete these results (and their attachments) and take them off their steps. Whatever any game asset or scene plan
 * uses is skipped, as in the library's bulk delete. Throws before deleting anything when protection could not load. */
export async function deleteResults(
  doc: GameAsset,
  items: Removable[],
  progress?: (done: number, total: number) => void,
): Promise<DeleteOutcome> {
  await loadForProtection();
  const fresh = docs.value.get(doc.id) ?? doc;
  const { gone, todo, failed } = await deleteAll(items.map((item) => item.asset), protectedFor(worldOf(fresh)), progress);
  await dropEverywhere(gone);
  return { deleted: todo.filter((asset) => gone.has(asset.id)).length, skipped: items.length - todo.length, failed };
}
