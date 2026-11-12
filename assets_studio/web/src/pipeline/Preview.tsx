// The large preview of one result: image, 3D model (with its animations) or text.
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
  const ready = useModelViewer(true);
  if (!ready) return <span class="thumb-icon">◆</span>;
  return (
    <model-viewer
      src={asset.file_url}
      loading="lazy"
      interaction-prompt="none"
      shadow-intensity="0"
      onLoad={clayIfShapeOnly(asset)}
    />
  );
}
