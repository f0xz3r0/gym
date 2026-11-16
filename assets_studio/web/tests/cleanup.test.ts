// Finding 18: both delete paths (library bulk delete and a game asset's Clean up) against a stub studio API.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { Asset, Job } from "../src/api/client";
import type { GameAsset } from "../src/pipeline/api";
import { deleteAssets, deleteResults, loadForProtection } from "../src/pipeline/cleanup";
import type { Scene } from "../src/pipeline/scenes";
import { stepById } from "../src/pipeline/steps";
import { asset, doc, job, scene } from "./fixtures";

interface Studio {
  docs: GameAsset[];
  scenes: Scene[];
  jobs: Map<string, Job>;
  assets: Map<string, Asset>;
  deleted: string[];
  broken: Set<string>;      // paths that answer 500
  refuse: Set<string>;      // asset ids whose delete answers 409
}
let studio: Studio;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const path = String(input);
  const method = init?.method ?? "GET";
  if (studio.broken.has(path)) return reply(500, { detail: "studio error" });
  if (path === "/api/pipeline/assets") return reply(200, studio.docs);
  if (path === "/api/pipeline/scenes") return reply(200, studio.scenes);
  if (method === "PUT" && path.startsWith("/api/pipeline/assets/")) {
    const body = JSON.parse(String(init?.body)) as GameAsset;
    const id = path.split("/").pop() ?? "";
    const saved = { ...studio.docs.find((d) => d.id === id)!, ...body, rev: (body.rev ?? 0) + 1 };
    studio.docs = studio.docs.map((d) => (d.id === id ? saved : d));
    return reply(200, saved);
  }
  const jobMatch = /^\/api\/jobs\/(.+)$/.exec(path);
  if (jobMatch) {
    const found = studio.jobs.get(jobMatch[1]!);
    return found ? reply(200, found) : reply(404, { detail: "no job" });
  }
  const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(path);
  if (assetMatch) {
    const id = assetMatch[1]!;
    const found = studio.assets.get(id);
    if (!found) return reply(404, { detail: "no asset" });
    if (method === "DELETE") {
      if (studio.refuse.has(id)) return reply(409, { detail: `asset ${id} is in use by a running job` });
      studio.deleted.push(id);
      const gone = { ...found, deleted_at: "now" };
      studio.assets.set(id, gone as Asset);
      return reply(200, gone);
    }
    return reply(200, found);
  }
  return reply(404, { detail: `unexpected ${method} ${path}` });
}) as typeof fetch;

// Two game assets and a scene plan, as in the 0b test (2026-11-16): B picked one of A's results, the plan uses a picture.
beforeEach(() => {
  const jobs = [job("ja", ["a1", "a2", "a3"]), job("jb", ["b1"]), job("joff", ["off1", "off2"])];
  const assets = ["a1", "a2", "a3", "b1", "off1", "off2", "scene-pic", "loose"].map((id) => asset(id));
  studio = {
    docs: [
      doc("A", { concept: { jobs: ["ja"], pick: "a1" }, detail: { include: false, jobs: ["joff"], pick: "off1" } }),
      doc("B", { concept: { jobs: ["jb"], extra: ["a2"], pick: "a2" } }),
    ],
    scenes: [scene("S", ["scene-pic"], ["a3"])],
    jobs: new Map(jobs.map((j) => [j.id, j])),
    assets: new Map(assets.map((a) => [a.id, a])),
    deleted: [],
    broken: new Set(),
    refuse: new Set(),
  };
});

const concept = stepById("concept")!;
const items = (ids: string[]) => ids.map((id) => ({ step: concept, asset: studio.assets.get(id)! }));

test("Clean up on A keeps B's pick, the scene plan's picture and A's off-step pick", async () => {
  const outcome = await deleteResults(studio.docs[0]!, items(["a1", "a2", "a3", "off1", "off2"]));
  assert.deepEqual(studio.deleted.sort(), ["off2"]);
  assert.equal(outcome.deleted, 1);
  assert.equal(outcome.skipped, 4);
  assert.deepEqual(outcome.failed, []);
});

test("library bulk delete keeps everything in use and deletes the rest", async () => {
  const list = [...studio.assets.values()];
  const outcome = await deleteAssets(list);
  assert.deepEqual(studio.deleted.sort(), ["b1", "loose", "off2"].sort());
  assert.equal(outcome.skipped, list.length - 3);
});

test("a job that fails to load stops the delete before anything goes", async () => {
  studio.docs.push(doc("C", { concept: { jobs: ["jc-never-loaded"], pick: "c1" } }));
  studio.broken.add("/api/jobs/jc-never-loaded");
  await assert.rejects(deleteAssets([studio.assets.get("loose")!]), /Nothing was deleted/);
  assert.deepEqual(studio.deleted, []);
});

test("scene plans that fail to load stop the delete, in both paths", async () => {
  studio.broken.add("/api/pipeline/scenes");
  await assert.rejects(loadForProtection(), /scene plans/);
  await assert.rejects(deleteResults(studio.docs[0]!, items(["off2"])), /Nothing was deleted/);
  assert.deepEqual(studio.deleted, []);
});

test("a delete the studio refuses is reported, not swallowed", async () => {
  studio.refuse.add("loose");
  const outcome = await deleteAssets([studio.assets.get("loose")!]);
  assert.equal(outcome.deleted, 0);
  assert.equal(outcome.failed.length, 1);
  assert.match(outcome.failed[0]!.reason, /in use by a running job/);
});
