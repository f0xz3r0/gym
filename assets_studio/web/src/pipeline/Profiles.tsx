// Prompt 2c: an asset's class and style profile (pipeline/profiles.json), and the asset check shown on the
// Send to Godot card (tools/asset_check.py). The check warns; it never blocks sending.
import { useEffect, useState } from "preact/hooks";

import { pipelineApi, type AssetCheckResult, type CheckFinding, type GameAsset, type ProfileOptions } from "./api";
import { act, update } from "./state";

let optionsCache: ProfileOptions | null = null;
let optionsLoading: Promise<ProfileOptions | undefined> | null = null;

function useProfileOptions(): ProfileOptions | null {
  const [options, setOptions] = useState<ProfileOptions | null>(optionsCache);
  useEffect(() => {
    if (optionsCache) return;
    optionsLoading ??= act(pipelineApi.profiles);
    void optionsLoading.then((loaded) => {
      if (!loaded) return;
      optionsCache = loaded;
      setOptions(loaded);
    });
  }, []);
  return options;
}

/** The class (guessed from the kind until chosen) and the style profile, changeable, in the asset page header. */
export function ClassProfileFields({ doc }: { doc: GameAsset }) {
  const options = useProfileOptions();
  if (!options) return null;
  const guessed = options.class_from_kind[doc.kind] ?? "small-prop";
  const chosenClass = doc.asset_class || "";
  const chosenProfile = doc.profile || "";
  const save = (change: Partial<Pick<GameAsset, "asset_class" | "profile">>) =>
    void act(() => update(doc.id, (next) => void Object.assign(next, change)));
  const title = (id: string) => options.classes.find((item) => item.id === id)?.title ?? id;
  const profileTitle = (id: string) => options.profiles.find((item) => item.id === id)?.title ?? id;
  return (
    <span class="class-profile">
      <label class="inline-field" title="Sets the triangle and texture budget, the collision and the checks (pipeline/profiles.json)">
        <span class="muted small">Class</span>
        <select value={chosenClass} onChange={(event) => save({ asset_class: event.currentTarget.value })}>
          <option value="">{title(guessed)} (from its kind)</option>
          {options.classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <label class="inline-field" title="Stylised or realistic budgets (STANDARDS section 1)">
        <span class="muted small">Profile</span>
        <select value={chosenProfile} onChange={(event) => save({ profile: event.currentTarget.value })}>
          <option value="">{profileTitle(options.default_profile)} (default)</option>
          {options.profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}

const ORDER = { bad: 0, warn: 1, info: 2 } as const;
const MARK = { bad: "●", warn: "▲", info: "✓" } as const;

export function CheckList({ findings, showInfo = true }: { findings: CheckFinding[]; showInfo?: boolean }) {
  const sorted = [...findings].filter((f) => showInfo || f.level !== "info").sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return (
    <ul class="check-list">
      {sorted.map((f) => (
        <li key={f.id + f.title} class={`check-${f.level}`}>
          <b>
            {MARK[f.level]} {f.title}
          </b>
          <span>{f.detail}</span>
          {f.fix && f.level !== "info" && <em class="check-nofix">{f.fix}</em>}
        </li>
      ))}
    </ul>
  );
}

/** The asset check of the result about to be sent, against the asset's class and profile. Re-run when the result,
 * the class, the profile, the real size or the file name changes. */
export function AssetCheckPanel({ doc, assetId, fileName }: { doc: GameAsset; assetId: string; fileName: string }) {
  const [result, setResult] = useState<AssetCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const key = [assetId, doc.asset_class, doc.profile, doc.kind, doc.godot.size?.join(), doc.godot.pivot, fileName].join("|");
  useEffect(() => {
    let live = true;
    setResult(null);
    const timer = setTimeout(() => {
      void pipelineApi
        .checkForGodot({ asset_id: assetId, pipeline_asset: doc.id, file_name: fileName })
        .then(
          (checked) => live && setResult(checked),
          (error: unknown) =>
            live && setResult({ findings: [], numbers: {}, error: error instanceof Error ? error.message : String(error) }),
        );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  if (!result) return <p class="muted small">Checking the model against its class…</p>;
  if (result.skipped) return null;
  if (result.error) return <p class="muted small">The check could not run: {result.error}</p>;
  const bad = result.findings.filter((f) => f.level === "bad").length;
  const warn = result.findings.filter((f) => f.level === "warn").length;
  const n = result.numbers;
  const facts = [
    typeof n.triangles === "number" && `${n.triangles.toLocaleString()} triangles`,
    Array.isArray(n.size_m) && `${(n.size_m as number[]).map((v) => v.toFixed(2)).join(" × ")} m`,
    Array.isArray(n.texture_sides) && (n.texture_sides as number[]).length > 0 && `${(n.texture_sides as number[])[0]} px textures`,
    typeof n.glb_bytes === "number" && `${(n.glb_bytes / 1e6).toFixed(1)} MB`,
  ].filter(Boolean);
  return (
    <div class={`motion-check asset-check${bad ? " has-bad" : warn ? " has-warn" : ""}`}>
      <button class="check-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>Check</b>{" "}
        {bad + warn === 0 ? (
          <span class="check-good">ready for Godot</span>
        ) : (
          <span>
            {bad > 0 && <span class="check-bad-text">{bad} bad</span>}
            {bad > 0 && warn > 0 && ", "}
            {warn > 0 && <span class="check-warn-text">{warn} to look at</span>}
          </span>
        )}
        <span class="muted small"> · {facts.join(" · ")}</span>
        <span class="muted small"> {open ? "▾" : "▸"} {open ? "hide" : "details"}</span>
      </button>
      {open && <CheckList findings={result.findings} />}
      {open && <p class="muted small">A warning never stops sending. Send to Godot fixes the ones it says it fixes.</p>}
    </div>
  );
}
