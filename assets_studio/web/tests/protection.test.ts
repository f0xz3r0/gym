// Finding 18: what a delete must leave alone (src/pipeline/protection.ts) and picked()'s answer when the pick is not loaded.
import assert from "node:assert/strict";
import { test } from "node:test";

import { protectedAll, protectedIds, sceneIds } from "../src/pipeline/protection";
import { picked, stepById } from "../src/pipeline/steps";
import { asset, doc, job, scene, world } from "./fixtures";

const step = (id: string) => {
  const found = stepById(id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

test("a stored pick on a step that is switched off is protected, with what it was made from", () => {
  const d = doc("A", { detail: { include: false, jobs: ["j1"], pick: "p1" } });
  const keep = protectedIds(world(d, [job("j1", ["p1", "p2"], { mesh: "m0" })], [asset("p1"), asset("p2")]));
  assert.ok(keep.has("p1"));
  assert.ok(keep.has("m0"));
  assert.ok(!keep.has("p2"), "the other result of an off step may go");
});

test("a stored pick whose job and asset never loaded is still protected", () => {
  const d = doc("A", { concept: { jobs: ["j-missing"], pick: "p-unloaded" } });
  assert.ok(protectedIds(world(d, [], [])).has("p-unloaded"));
});

test("picked() gives nothing, not the newest, while the real pick is not loaded", () => {
  const d = doc("A", { concept: { jobs: ["j1", "j2"], pick: "p1" } });
  const newest = job("j2", ["p9"]);
  // j1 (which made p1) is not loaded: the newest result p9 must not stand in for the pick
  const w = world(d, [newest], [asset("p9")]);
  assert.equal(picked(w, step("concept")), undefined);
  assert.ok(!protectedIds(w).has("p9"), "the newest is not protected in the pick's place");
  assert.ok(protectedIds(w).has("p1"));
});

test("picked() falls back to the newest when the pick is known to be deleted", () => {
  const d = doc("A", { concept: { jobs: ["j1", "j2"], pick: "p1" } });
  const w = world(d, [job("j1", ["p1"]), job("j2", ["p9"])], [asset("p1", { deleted_at: "x" }), asset("p9")]);
  assert.equal(picked(w, step("concept"))?.asset.id, "p9");
});

test("with no pick stored, the newest result of an included step is protected", () => {
  const d = doc("A", { concept: { jobs: ["j1", "j2"] } });
  const keep = protectedIds(world(d, [job("j1", ["c1"]), job("j2", ["c2"], { image: "ref" })], [asset("c1"), asset("c2")]));
  assert.ok(keep.has("c2") && keep.has("ref"));
  assert.ok(!keep.has("c1"));
});

test("step references and the attachments of protected results are protected", () => {
  const d = doc("A", {
    concept: { reference: "ref-pic", jobs: ["j1"], pick: "c1" },
    motionvideo: { include: false, reference: "input-video" },
  });
  const keep = protectedIds(world(d, [job("j1", ["c1"])], [asset("c1", { meta: { film_asset: "film" } })]));
  for (const id of ["ref-pic", "input-video", "c1", "film"]) assert.ok(keep.has(id), id);
});

test("scene plans protect their concept pictures and each row's concept", () => {
  const keep = sceneIds([scene("S", ["mood", "street"], ["street", null, "front"])]);
  assert.deepEqual([...keep].sort(), ["front", "mood", "street"]);
});

test("protection across game assets: B's pick is safe from a delete started on A", () => {
  const a = doc("A", { concept: { jobs: ["ja"], pick: "a1" } });
  const b = doc("B", { concept: { jobs: ["jb"], extra: ["a2"], pick: "a2" } });   // B uses A's other result
  const jobs = [job("ja", ["a1", "a2"]), job("jb", ["b1"])];
  const assets = [asset("a1"), asset("a2"), asset("b1")];
  const onlyA = protectedIds(world(a, jobs, assets));
  assert.ok(!onlyA.has("a2"), "A alone does not know about B's use");
  const all = protectedAll([world(a, jobs, assets), world(b, jobs, assets)], [scene("S", ["s1"], [])]);
  for (const id of ["a1", "a2", "s1"]) assert.ok(all.has(id), id);
});
