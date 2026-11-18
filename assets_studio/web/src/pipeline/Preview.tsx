// The large preview of one result: image, 3D model (with its animations) or text.
import { SnapshotThumb } from "../components/snapshotThumbs";
import { useEffect, useRef, useState } from "preact/hooks";

import type { Asset } from "../api/client";
import { clayIfShapeOnly, useModelViewer } from "../components/AssetPreview";
import type { inspectMesh, MeshView } from "../components/meshInspection";
import { assetText } from "./state";

type AnimatedViewer = HTMLElement & {
  availableAnimations?: string[];
  animationName?: string;
  play?: () => void;
  pause?: () => void;
  paused?: boolean;
};

/** Viewer choices kept while you click between results (as in the classic library). */
let keptSkeleton = true;
let keptView: MeshView = "material";

function ModelView({ asset }: { asset: Asset }) {
  const ready = useModelViewer(true);
  const [viewer, setViewer] = useState<AnimatedViewer | null>(null);
  const [clips, setClips] = useState<string[]>([]);
  const [clip, setClip] = useState("");
  const [failed, setFailed] = useState(false);
  const inspection = useRef<ReturnType<typeof inspectMesh> | null>(null);
  const [bones, setBones] = useState<string[]>([]);
  const [inspected, setInspected] = useState(false);
  const [showBones, setShowBones] = useState(keptSkeleton);
  const [view, setView] = useState<MeshView>(keptView);
  useEffect(() => {
    setClips([]);
    setClip("");
    setFailed(false);
    setBones([]);
    setInspected(false);
    return () => {
      inspection.current?.dispose();
      inspection.current = null;
    };
  }, [asset.id]);
  useEffect(() => {
    keptSkeleton = showBones;
    inspection.current?.setSkeleton(showBones);
  }, [showBones, inspected]);
  useEffect(() => {
    keptView = view;
    inspection.current?.setView(view, false);
  }, [view, inspected]);
  if (!ready) return <div class="preview-empty"><span class="spinner" /></div>;
  if (failed) return <div class="preview-empty">This model could not be shown. Download it to open it in Blender.</div>;
  const clay = clayIfShapeOnly(asset);
  return (
    <>
      <model-viewer
        key={asset.id}
        ref={(element: AnimatedViewer | null) => setViewer(element)}
        src={asset.file_url}
        camera-controls
        autoplay
        shadow-intensity="0.7"
        exposure="1.05"
        interaction-prompt="none"
        aria-label={asset.title ?? "3D model"}
        onLoad={(event: Event) => {
          clay?.(event);
          const element = event.target as AnimatedViewer;
          const names = element.availableAnimations ?? [];
          setClips(names);
          setClip(names[0] ?? "");
          void import("../components/meshInspection").then(({ inspectMesh }) => {
            if (!element.isConnected) return;
            inspection.current?.dispose();
            try {
              inspection.current = inspectMesh(element);
              setBones(inspection.current.bones);
              setInspected(true);
            } catch {
              inspection.current = null;
            }
          });
        }}
        onError={() => setFailed(true)}
      />
      {inspected && (
        <div class="viewer-bar inspect-bar">
          <div class="segmented" role="group" aria-label="View">
            {(["material", "geometry", "wireframe"] as const).map((mode) => (
              <button key={mode} class="button small" aria-pressed={view === mode} onClick={() => setView(mode)}>
                {mode === "material" ? "Material" : mode === "geometry" ? "Clay" : "Wireframe"}
              </button>
            ))}
          </div>
          {bones.length > 0 ? (
            <>
              <label class="check">
                <input type="checkbox" checked={showBones} onChange={(event) => setShowBones(event.currentTarget.checked)} />
                Skeleton · {bones.length} bones
              </label>
              <details class="bone-names">
                <summary>Bone names</summary>
                <div>{bones.join(", ")}</div>
              </details>
            </>
          ) : (
            <span class="muted small">No skeleton</span>
          )}
        </div>
      )}
      {clips.length > 0 && (
        <div class="viewer-bar">
          <span>Animation</span>
          <select
            value={clip}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setClip(name);
              if (viewer) {
                viewer.animationName = name;
                viewer.play?.();
              }
            }}
          >
            {clips.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            class="button small"
            onClick={() => (viewer?.paused ? viewer.play?.() : viewer?.pause?.())}
          >
            Play / pause
          </button>
        </div>
      )}
    </>
  );
}

/** An animation from the AI-video pipeline: the model, its review film (video | fit | overlay, 3/4) and, from v1.1,
 * the auto-rig's poses sheet (the rig bent in test poses: tearing or a limb dragging the body means bad weights). */
export interface Finding { id: string; level: "info" | "warn" | "bad"; title: string; detail: string; fix: string | null; bones?: string[] }

/** The texture check (tools/texture_check.py, prompt 2b): findings in plain words, worst first, each with what
 * would help, and the measured numbers. Shown for painted results (meta.texture_check). */
export function TextureCheck({ findings, numbers }: { findings: Finding[]; numbers?: Record<string, unknown> | undefined }) {
  const order = { bad: 0, warn: 1, info: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const n = numbers ?? {};
  const facts = [
    typeof n.texture_size === "number" && `${n.texture_size} px`,
    typeof n.texels_per_metre === "number" && `${Math.round(n.texels_per_metre)} texels/m`,
    typeof n.islands === "number" && `${n.islands} islands`,
    typeof n.uv_coverage === "number" && `${Math.round(n.uv_coverage * 100)} % used`,
  ].filter(Boolean);
  return (
    <div class="motion-check texture-check">
      {facts.length > 0 && <p class="muted small">{facts.join(" · ")}</p>}
      <ul class="check-list">
        {sorted.map((f) => (
          <li key={f.id} class={`check-${f.level}`}>
            <b>{f.level === "bad" ? "●" : f.level === "warn" ? "▲" : "✓"} {f.title}</b>
            <span>{f.detail}</span>
            {f.fix && f.level !== "info" && <em class="check-nofix">{f.fix}</em>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What each Tune fix does (tools/v2r2.py TUNE). */
const FIXES: Record<string, string> = {
  limit_twist: "Hold the roll still (twist up to 3°)",
  widen_range: "Let these joints bend further (up to 130°)",
  smooth: "Smooth the whole motion (fast swings may lose a little reach)",
  smooth_parts: "Smooth these parts only",
  floor: "Press the feet onto the floor",
};

export type TuneHandler = (fixes: string[]) => Promise<unknown>;

/** What to do about a finding no refit can fix. */
const NO_FIX: Record<string, string> = {
  seam: "A refit cannot change how well the stride repeats: make another take (Motion video, Run again) and fit that.",
  sideways: "The cameras cannot see it: remake the rig with Camera views side,top.",
};

/** The motion check (tools/v2r_motion_check.py): findings in plain words, and the contact sheet (side, top and
 * three-quarter at five moments of the loop). */
export function MotionCheck({ findings, sheet, tuned, onTune }: {
  findings: Finding[];
  sheet: string | undefined;
  tuned?: string[] | undefined;
  onTune?: TuneHandler | undefined;
}) {
  const order = { bad: 0, warn: 1, info: 2 } as const;
  // a tuned result starts with its own fixes ticked: a refit starts again from the take's plain fit, so what is not
  // ticked is not applied, and unticked fixes would otherwise be dropped silently
  const [ticked, setTicked] = useState<Set<string>>(new Set(tuned ?? []));
  const [busy, setBusy] = useState(false);
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  // every finding with a fix gets its checkbox; findings that share a fix (a snap and trembling: "smooth") share it
  const offered = new Set<string>();
  // the same fixes as this result has would make the same result again
  const same = (tuned?.length ?? 0) > 0 && ticked.size === tuned!.length && tuned!.every((f) => ticked.has(f));
  const toggle = (fix: string) =>
    setTicked((now) => {
      const next = new Set(now);
      if (next.has(fix)) next.delete(fix);
      else next.add(fix);
      return next;
    });
  return (
    <div class="motion-check">
      {tuned && tuned.length > 0 && (
        <div class="check-tuned">
          <b>This result is tuned with:</b>
          {onTune
            ? tuned.filter((f) => FIXES[f]).map((f) => (
                <label key={f} class="check-fix">
                  <input type="checkbox" checked={ticked.has(f)} onChange={() => toggle(f)} />
                  {FIXES[f]}
                </label>
              ))
            : <span>{tuned.map((f) => FIXES[f] ?? f).join(" · ")}</span>}
          {onTune && <span class="muted small">Untick one to drop it at the next refit.</span>}
        </div>
      )}
      <ul class="check-list">
        {sorted.map((f) => {
          const fix = f.fix && FIXES[f.fix] && onTune ? f.fix : null;
          const shared = fix !== null && offered.has(fix);
          if (fix) offered.add(fix);
          return (
            <li key={f.id} class={`check-${f.level}`}>
              <b>{f.level === "bad" ? "●" : f.level === "warn" ? "▲" : "✓"} {f.title}</b>
              <span>{f.detail}</span>
              {fix && (
                <label class="check-fix">
                  <input type="checkbox" checked={ticked.has(fix)} onChange={() => toggle(fix)} />
                  {FIXES[fix]}
                  {shared && <span class="muted"> (same fix as above)</span>}
                  {tuned?.includes(fix) && <span class="muted"> (applied, still here)</span>}
                </label>
              )}
              {!fix && f.level !== "info" && NO_FIX[f.id] && <em class="check-nofix">{NO_FIX[f.id]}</em>}
            </li>
          );
        })}
      </ul>
      {onTune && (offered.size > 0 || (tuned?.length ?? 0) > 0) && (
        <div class="check-actions">
          <button class="button primary" disabled={busy || ticked.size === 0 || same}
            onClick={() => {
              setBusy(true);
              void onTune([...ticked]).finally(() => setBusy(false));
            }}>
            {same
              ? "These fixes are already applied"
              : ticked.size ? `Refit with ${ticked.size} fix${ticked.size > 1 ? "es" : ""}` : "Tick the fixes you want"}
          </button>
          <span class="muted small">Same video, about a minute. A new result; this one stays. Anything not ticked is kept as it is.</span>
        </div>
      )}
      {sheet && (
        <figure class="check-sheet">
          <img src={`/api/assets/${sheet}/file`} alt="The loop from the side, from above and at three-quarter, at five moments" />
          <figcaption>Rows: side · from above · three-quarter. Columns: five moments across the loop.</figcaption>
        </figure>
      )}
    </div>
  );
}

function WithReview({ asset, review, poses, skeleton, start }: { asset: Asset; review: string | undefined; poses: string | undefined; skeleton: string | undefined; start: string | undefined }) {
  const [tab, setTab] = useState<"model" | "film" | "poses" | "skeleton" | "start">("model");
  useEffect(() => setTab("model"), [asset.id]);
  return (
    <>
      {tab === "film" && review ? (
        <video class="video-preview" key={review} src={`/api/assets/${review}/file`} controls autoplay muted loop playsinline />
      ) : tab === "start" && start ? (
        <div class="checker">
          <img src={`/api/assets/${start}/file`} alt="The start frame the video begins from (front | side)" />
        </div>
      ) : tab === "skeleton" && skeleton ? (
        <div class="checker">
          <img src={`/api/assets/${skeleton}/file`} alt="The auto-rig skeleton from the side, front and top" />
        </div>
      ) : tab === "poses" && poses ? (
        <div class="checker">
          <img src={`/api/assets/${poses}/file`} alt="The rig in test poses" />
        </div>
      ) : (
        <ModelView asset={asset} />
      )}
      <div class="viewer-tabs">
        <button class={`button small${tab === "model" ? " active" : ""}`} onClick={() => setTab("model")}>Model</button>
        {review && (
          <button class={`button small${tab === "film" ? " active" : ""}`} onClick={() => setTab("film")}>Review film</button>
        )}
        {start && (
          <button class={`button small${tab === "start" ? " active" : ""}`} onClick={() => setTab("start")}
            title="The relaxed start pose, front | side: the first frame of the video">
            Start frame
          </button>
        )}
        {skeleton && (
          <button class={`button small${tab === "skeleton" ? " active" : ""}`} onClick={() => setTab("skeleton")}>
            Skeleton sheet
          </button>
        )}
        {poses && (
          <button class={`button small${tab === "poses" ? " active" : ""}`} onClick={() => setTab("poses")}
            title="The auto-rig bent in test poses: tearing or a limb dragging the body means bad weights">
            Rig test poses
          </button>
        )}
      </div>
    </>
  );
}

function TextView({ asset }: { asset: Asset }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    void assetText(asset).then(setText, () => setText("(could not load)"));
  }, [asset.id]);
  return <pre class="text-preview">{text ?? "Loading…"}</pre>;
}

export function Preview({ asset }: { asset: Asset | undefined }) {
  if (!asset) return <div class="preview-empty">Results appear here.</div>;
  if (asset.kind === "image")
    return (
      <div class="checker">
        <img src={asset.file_url} alt={asset.title ?? "Result"} />
      </div>
    );
  if (asset.mime === "model/gltf-binary") {
    const meta = asset.meta as Record<string, unknown>;
    const review = meta.review_asset;
    const poses = typeof meta.rig_poses_asset === "string" ? meta.rig_poses_asset : undefined;
    const skeleton = typeof meta.skeleton_sheet_asset === "string" ? meta.skeleton_sheet_asset : undefined;
    const start = typeof meta.start_frame_asset === "string" ? meta.start_frame_asset : undefined;
    return typeof review === "string" || poses || skeleton || start ? (
      <WithReview asset={asset} review={typeof review === "string" ? review : undefined} poses={poses} skeleton={skeleton} start={start} />
    ) : (
      <ModelView asset={asset} />
    );
  }
  if (asset.kind === "text") return <TextView asset={asset} />;
  if (asset.mime.startsWith("video/"))
    return (
      <video class="video-preview" key={asset.id} src={asset.file_url} controls autoplay muted loop playsinline />
    );
  return (
    <div class="preview-empty">
      No preview for {asset.mime} here. Use Download to open it in Blender.
    </div>
  );
}

/** Facts worth knowing about a result, from its metadata. */
export function facts(asset: Asset): string[] {
  const meta = asset.meta as Record<string, unknown>;
  const out: string[] = [];
  const number = (value: unknown) => (typeof value === "number" ? value.toLocaleString() : null);
  if (number(meta.triangles)) out.push(`${number(meta.triangles)} triangles`);
  if (typeof meta.width === "number" && typeof meta.height === "number") out.push(`${meta.width}×${meta.height}`);
  if (number(meta.bones)) out.push(`${number(meta.bones)} bones`);
  if (meta.watertight === true) out.push("closed surface");
  if (meta.color === "none") out.push("shape only, no colour");
  // Animation pipeline v2.0: the rig gate of the auto-rig
  const gate = meta.rig_gate as
    | { body?: string; facing?: string; legs?: number; floor_contacts?: number[] | null; problems?: string[] }
    | undefined;
  if (gate) {
    out.push(`auto-rig: ${gate.body}, facing ${gate.facing}, ${gate.legs} legs`);
    if (gate.floor_contacts) out.push(`feet reached ${gate.floor_contacts[0]}/${gate.floor_contacts[1]}`);
    for (const problem of gate.problems ?? []) out.push(`⚠ ${problem}`);
    if (!gate.problems?.length) out.push("rig gate passed: check the test poses");
  }
  const strides = (meta.loop as { strides?: number } | undefined)?.strides;
  if (typeof strides === "number") out.push(`${strides} stride${strides > 1 ? "s" : ""}`);
  // Animation pipeline (motion from an AI video): the loop, the in-place speed, the two-view check.
  const loop = meta.loop as { seconds?: number } | null | undefined;
  if (loop && typeof loop.seconds === "number")
    out.push(`${loop.seconds.toFixed(2)} s ${(loop as { whole_clip?: boolean }).whole_clip ? "clip (plays once, repeats)" : "loop"}`);
  if (meta.pipeline === "Kimodo text to motion") out.push("Kimodo");
  if (typeof meta.ground_speed_units_per_s === "number")
    out.push(`moves ${meta.ground_speed_units_per_s.toFixed(2)} units/s (in place)`);
  if (typeof meta.move === "string" && meta.loop) out.push(`“${meta.move}”`);
  if (meta.two_view_check && typeof meta.two_view_check === "object") {
    const lines = Object.values(meta.two_view_check as Record<string, string>);
    if (lines.some((line) => line.startsWith("OK"))) out.push("front and side views agree");
  }
  if (meta.shows && asset.mime.startsWith("video/")) out.push("review film");
  out.push(`${(asset.size_bytes / 1e6).toFixed(1)} MB`);
  return out;
}

/** A small square picture of a result for lists. */
export function Thumb({ asset }: { asset: Asset | undefined }) {
  if (!asset) return <span class="thumb-empty" />;
  if (asset.kind === "image") return <img src={asset.file_url} alt="" loading="lazy" />;
  if (asset.mime === "model/gltf-binary") return <MeshThumb asset={asset} />;
  if (asset.mime.startsWith("video/")) return <span class="thumb-icon" title="Video">▶</span>;
  return <span class="thumb-icon">{asset.kind === "text" ? "Aa" : "◆"}</span>;
}

function MeshThumb({ asset }: { asset: Asset }) {
  return <SnapshotThumb asset={asset} />;
}
