// The large preview of one result: image, 3D model (with its animations) or text.
import { useEffect, useState } from "preact/hooks";

import type { Asset } from "../api/client";
import { clayIfShapeOnly, useModelViewer } from "../components/AssetPreview";
import { assetText } from "./state";

type AnimatedViewer = HTMLElement & {
  availableAnimations?: string[];
  animationName?: string;
  play?: () => void;
  pause?: () => void;
  paused?: boolean;
};

function ModelView({ asset }: { asset: Asset }) {
  const ready = useModelViewer(true);
  const [viewer, setViewer] = useState<AnimatedViewer | null>(null);
  const [clips, setClips] = useState<string[]>([]);
  const [clip, setClip] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setClips([]);
    setClip("");
    setFailed(false);
  }, [asset.id]);
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
          const names = (event.target as AnimatedViewer).availableAnimations ?? [];
          setClips(names);
          setClip(names[0] ?? "");
        }}
        onError={() => setFailed(true)}
      />
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
  if (asset.mime === "model/gltf-binary") return <ModelView asset={asset} />;
  if (asset.kind === "text") return <TextView asset={asset} />;
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
  out.push(`${(asset.size_bytes / 1e6).toFixed(1)} MB`);
  return out;
}

/** A small square picture of a result for lists. */
export function Thumb({ asset }: { asset: Asset | undefined }) {
  if (!asset) return <span class="thumb-empty" />;
  if (asset.kind === "image") return <img src={asset.file_url} alt="" loading="lazy" />;
  if (asset.mime === "model/gltf-binary") return <MeshThumb asset={asset} />;
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
