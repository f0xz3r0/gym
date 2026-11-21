// B48 (owner 2026-11-21): Split parts is on by default for vehicles only; it takes the finished mesh and its result is
// what Send to Godot exports, while the rig steps keep taking the whole mesh.
import assert from "node:assert/strict";
import { test } from "node:test";

import { FINAL_CHAIN, STEPS } from "../src/pipeline/steps";

const parts = STEPS.find((step) => step.id === "parts")!;
const rig = STEPS.find((step) => step.id === "rig")!;

test("on for vehicles only", () => {
  assert.equal(parts.defaultOn("mechanical"), true);
  for (const kind of ["prop", "character", "creature"] as const) assert.equal(parts.defaultOn(kind), false);
});

test("takes the finished mesh; Godot gets the parts; rigs do not", () => {
  assert.deepEqual(parts.from.mesh.slice(0, 3), ["normals", "repair", "rebake"]);
  assert.ok(FINAL_CHAIN.indexOf("parts") < FINAL_CHAIN.indexOf("normals"));
  assert.ok(!rig.from.mesh.includes("parts"));
});
