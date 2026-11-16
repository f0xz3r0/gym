// Bundle each tests/*.test.ts with rolldown (already a vite dependency) and run it with node's own test runner.
// Usage: npm test
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = join(here, "..", "node_modules", ".cache", "unit-tests");
mkdirSync(out, { recursive: true });
const files = readdirSync(here).filter((f) => f.endsWith(".test.ts"));
const { build } = await import("rolldown");
const built = [];
for (const file of files) {
  const target = join(out, file.replace(/\.ts$/, ".mjs"));
  await build({ input: join(here, file), platform: "node", output: { file: target, format: "esm" }, logLevel: "warn" });
  built.push(target);
}
execFileSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
