// B37 / B46 (Studio prompt 2d): the 3D style lock's words go at the start of the concept prompt once, and its negative
// terms join the image model's negative prompt without repeats.
import assert from "node:assert/strict";
import { test } from "node:test";

import { negativeWithLock, type StyleLock, subjectSentence, withStyleLock } from "../src/pipeline/steps";

const lock: StyleLock = {
  profile: "stylised",
  prompt: "stylised game asset, soft shapes. Colour palette: bin green, cream.",
  negative: "photo, text, watermark",
  references: [],
};

test("lock words go before the description and the size sentence (B46)", () => {
  const prompt = "A green bin with a lid. Real size: 1 m tall.";
  assert.equal(withStyleLock(prompt, lock), `${lock.prompt} ${prompt}`);
});

test("lock words are added once, however often the prompt passes through", () => {
  const once = withStyleLock("A green bin", lock);
  assert.equal(once, `${lock.prompt} A green bin`);
  assert.equal(withStyleLock(once, lock), once);
});

test("subject sentence first, then the lock, then the description (B46), once", () => {
  const subject = subjectSentence("Fence panel");
  assert.equal(subject, "A single fence panel.");
  const once = withStyleLock("Twelve rainbow posts.", lock, subject);
  assert.equal(once, `A single fence panel. ${lock.prompt} Twelve rainbow posts.`);
  assert.equal(withStyleLock(once, lock, subject), once);
  assert.equal(subjectSentence("  "), "");
});

test("no lock or an empty prompt leaves the prompt alone", () => {
  assert.equal(withStyleLock("A bin.", undefined), "A bin.");
  assert.equal(withStyleLock("", lock), "");
  assert.equal(withStyleLock("A bin.", { ...lock, prompt: "" }), "A bin.");
});

test("negative terms are merged without repeats", () => {
  assert.equal(negativeWithLock("text, blurry", lock), "text, blurry, photo, watermark");
  assert.equal(negativeWithLock("", lock), "photo, text, watermark");
  assert.equal(negativeWithLock("text, blurry", undefined), "text, blurry");
});
