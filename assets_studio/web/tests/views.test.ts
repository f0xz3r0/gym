// Phase 3 3b (owner 2026-11-21): the Views shape server (turnaround sheet -> Pixal3D multi-view) is offered for
// characters and creatures only; TRELLIS.2 stays the default shape server for every kind.
import assert from "node:assert/strict";
import { test } from "node:test";

import { effective, STEPS } from "../src/pipeline/steps";
import { doc, world } from "./fixtures";

const shape = STEPS.find((step) => step.id === "shape")!;

test("characters and creatures get the Views server, after TRELLIS.2", () => {
  for (const kind of ["character", "creature"]) {
    const servers = effective(world(doc("a", {}, kind), [], []), shape).servers;
    assert.ok(servers.includes("pixal3d-views"));
    assert.equal(servers[0], "trellis2-shape");
  }
});

test("props and vehicles do not", () => {
  for (const kind of ["prop", "mechanical"]) {
    const servers = effective(world(doc("a", {}, kind), [], []), shape).servers;
    assert.ok(!servers.includes("pixal3d-views"));
    assert.equal(servers[0], "trellis2-shape");
  }
});
