// The preview pane while a step works: an animation for the kind of step, with its progress underneath.
import { useState } from "preact/hooks";

import type { Job } from "../api/client";
import { Holo3D } from "./Holo3D";
import type { StepDef } from "./steps";
import { clock, ProgressBar, progressLabel, useProgress } from "./ui";

type Scene = "image" | "mesh" | "paint" | "rig" | "motion";

const SCENE: Record<string, Scene> = {
  concept: "image",
  cutout: "image",
  shape: "mesh",
  detail: "mesh",
  cleanup: "mesh",
  gamemesh: "mesh",
  paint: "paint",
  rebake: "paint",
  repair: "paint",
  normals: "paint",
  rig: "rig",
  animrig: "rig",
  motionreader: "rig",
  motionvideo: "motion",
  motion: "motion",
  textmotion: "motion",
  mocap: "motion",
  animate: "motion",
};

const CAPTION: Record<Scene, string[]> = {
  image: ["Sketching the shapes", "Laying in colour", "Sharpening the details"],
  mesh: ["Reading the picture", "Growing the surface", "Tightening the mesh"],
  paint: ["Unfolding the surface", "Mixing the colours", "Painting it on"],
  rig: ["Finding the joints", "Placing the bones", "Binding the skin"],
  motion: ["Learning the body", "Reading the move", "Putting it in motion"],
};

export function WorkingPreview({ step, job, model }: { step: StepDef; job: Job; model?: string | undefined }) {
  const scene = SCENE[step.id] ?? "mesh";
  const [failed, setFailed] = useState<string | null>(null);
  // rig and motion steps show the creature itself as a 3D hologram when its model is known
  const holo = (scene === "rig" || scene === "motion") && model && failed !== model ? model : undefined;
  const progress = useProgress(job, step.typical);
  const lines = CAPTION[scene];
  // the caption follows the progress when there is an estimate, else it turns every 6 s
  const stage =
    progress.fraction !== undefined
      ? Math.min(lines.length - 1, Math.floor(progress.fraction * lines.length))
      : Math.floor(progress.elapsed / 6) % lines.length;
  const waiting = progress.phase !== "running" && progress.phase !== "open";
  return (
    <div class={`working working-${scene}${waiting ? " is-waiting" : ""}${holo ? " has-holo" : ""}`} aria-live="polite">
      <div class="working-stage" aria-hidden="true">
        {holo ? (
          <Holo3D key={holo} url={`/api/assets/${holo}/file`} onFail={() => setFailed(holo)} />
        ) : (
          <>
        {scene === "image" && <ImageScene />}
        {scene === "mesh" && <MeshScene />}
        {scene === "paint" && <PaintScene />}
        {scene === "rig" && <RigScene />}
        {scene === "motion" && <MotionScene frame={Math.round(progress.elapsed * 24)} />}
          </>
        )}
      </div>
      <div class="working-info">
        <div class="working-title">{step.title}</div>
        <div class="working-caption" key={waiting ? "wait" : stage}>
          {waiting ? progressLabel(progress) : progress.phase === "open" ? "Open in the editor" : lines[stage] + "…"}
        </div>
        <ProgressBar progress={progress} />
        <div class="working-meta muted">
          {progress.fraction !== undefined && !progress.over && <>{Math.round(progress.fraction * 100)} % · </>}
          {progress.left !== undefined && <>about {clock(Math.round(progress.left))} left · </>}
          {progress.over && <>almost there · </>}
          {clock(progress.elapsed)} elapsed
        </div>
      </div>
    </div>
  );
}

/** A canvas: brush strokes draw themselves in, a light sweep passes over. */
function ImageScene() {
  return (
    <svg viewBox="0 0 200 160" class="scene">
      <defs>
        <linearGradient id="w-sheen" x1="0" x2="1">
          <stop offset="0" stop-color="white" stop-opacity="0" />
          <stop offset="0.5" stop-color="white" stop-opacity="0.55" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <clipPath id="w-canvas">
          <rect x="20" y="14" width="160" height="132" rx="8" />
        </clipPath>
      </defs>
      <rect x="20" y="14" width="160" height="132" rx="8" class="canvas" />
      <g clip-path="url(#w-canvas)">
        <path class="stroke s1" d="M30 120 C 60 60, 90 60, 120 110 S 170 140, 175 70" />
        <path class="stroke s2" d="M40 50 C 70 30, 110 40, 150 30" />
        <path class="stroke s3" d="M60 135 C 80 100, 130 95, 165 120" />
        <circle class="blob b1" cx="70" cy="80" r="18" />
        <circle class="blob b2" cx="135" cy="65" r="14" />
        <rect class="sheen" x="-80" y="0" width="70" height="160" fill="url(#w-sheen)" />
      </g>
      <g class="brush">
        <rect x="-3" y="-30" width="6" height="26" rx="3" />
        <path d="M-5 -4 L5 -4 L2 6 L-2 6 Z" />
      </g>
    </svg>
  );
}

/** A wireframe sphere turning while its points settle onto it. */
function MeshScene() {
  const longitudes = [0, 1, 2, 3, 4, 5];
  const latitudes = [-50, -25, 0, 25, 50];
  return (
    <svg viewBox="-100 -80 200 160" class="scene">
      <g class="globe">
        <circle r="56" class="rim" />
        {latitudes.map((lat) => {
          const y = 56 * Math.sin((lat * Math.PI) / 180);
          const rx = 56 * Math.cos((lat * Math.PI) / 180);
          return <ellipse key={lat} cx="0" cy={y} rx={rx} ry={rx * 0.18} class="lat" />;
        })}
        {longitudes.map((k) => (
          <ellipse key={k} cx="0" cy="0" rx="56" ry="56" class="lon" style={{ animationDelay: `${-k * 0.5}s` }} />
        ))}
      </g>
      {Array.from({ length: 14 }, (_, k) => {
        const a = (k / 14) * Math.PI * 2;
        return (
          <circle
            key={k}
            class="vert"
            r="2.6"
            cx={Math.cos(a) * 56}
            cy={Math.sin(a) * 56 * 0.55}
            style={{ animationDelay: `${(k % 7) * 0.25}s`, ["--dx" as string]: `${Math.cos(a) * 30}px`, ["--dy" as string]: `${Math.sin(a) * 30}px` }}
          />
        );
      })}
    </svg>
  );
}

/** A sphere taking on colour: bands of paint sweep across it. */
function PaintScene() {
  return (
    <svg viewBox="-100 -80 200 160" class="scene">
      <defs>
        <clipPath id="w-ball">
          <circle r="58" />
        </clipPath>
        <radialGradient id="w-shade" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="white" stop-opacity="0.45" />
          <stop offset="1" stop-color="black" stop-opacity="0.35" />
        </radialGradient>
      </defs>
      <circle r="58" class="ball" />
      <g clip-path="url(#w-ball)">
        <g class="bands">
          <rect x="-180" y="-80" width="60" height="160" class="band c1" />
          <rect x="-120" y="-80" width="60" height="160" class="band c2" />
          <rect x="-60" y="-80" width="60" height="160" class="band c3" />
          <rect x="0" y="-80" width="60" height="160" class="band c4" />
          <rect x="60" y="-80" width="60" height="160" class="band c1" />
          <rect x="120" y="-80" width="60" height="160" class="band c2" />
        </g>
        <circle r="58" fill="url(#w-shade)" />
      </g>
      <circle r="58" class="rim" />
    </svg>
  );
}

/** A creature's skeleton: joints appear, bones draw between them. */
function RigScene() {
  const joints: [number, number][] = [
    [0, -58], [0, -30], [0, 0], [0, 26], [-34, -24], [-52, 4], [34, -24], [52, 4], [-18, 58], [18, 58], [-20, 28], [20, 28],
  ];
  const bones: [number, number][] = [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [1, 6], [6, 7], [3, 10], [10, 8], [3, 11], [11, 9]];
  return (
    <svg viewBox="-100 -80 200 160" class="scene">
      <ellipse cx="0" cy="0" rx="62" ry="74" class="body" />
      {bones.map(([a, b], k) => {
        const [x1, y1] = joints[a] ?? [0, 0];
        const [x2, y2] = joints[b] ?? [0, 0];
        return <line key={k} class="bone" x1={x1} y1={y1} x2={x2} y2={y2} style={{ animationDelay: `${0.25 * k}s` }} />;
      })}
      {joints.map(([x, y], k) => (
        <circle key={k} class="joint" cx={x} cy={y} r="4.5" style={{ animationDelay: `${0.18 * k}s` }} />
      ))}
    </svg>
  );
}

/** Motion capture HUD: falling code, a neon armoured walker with motion trails on a moving grid, a scan line and a
 * tracking readout. Its own dark screen in both themes. */
const GLYPHS = "0123456789ABCDEF<>/\\=+*#%";

function rainColumn(seed: number, length: number) {
  let out = "";
  let x = seed * 9301 + 49297;
  for (let k = 0; k < length; k++) {
    x = (x * 9301 + 49297) % 233280;
    out += GLYPHS[x % GLYPHS.length];
  }
  return out;
}

function Walker({ lag, ghost }: { lag: number; ghost?: boolean }) {
  return (
    <g class={`walker${ghost ? " ghost" : ""}`} style={{ ["--lag" as string]: `${-lag}s` }}>
      {/* far side first */}
      <g class="leg l-back">
        <path class="plate back" d="M-6 6 L6 6 L4 34 L-4 34 Z" />
        <g class="shin">
          <path class="plate back" d="M-4 34 L4 34 L3 58 L-3 58 Z" />
          <path class="plate back" d="M-3 58 L10 58 L12 62 L-5 62 Z" />
        </g>
      </g>
      <g class="arm a-back">
        <path class="plate back" d="M-4 -30 L4 -30 L3 -6 L-3 -6 Z" />
      </g>
      {/* torso and head */}
      <path class="plate core" d="M-13 -38 L13 -38 L10 -12 L7 8 L-7 8 L-10 -12 Z" />
      <path class="seam" d="M0 -36 L0 6 M-10 -18 L10 -18" />
      <path class="plate head" d="M-9 -60 L9 -60 L11 -48 L6 -42 L-6 -42 L-11 -48 Z" />
      <path class="visor" d="M-7 -53 L7 -53 L6 -49 L-6 -49 Z" />
      <g class="leg l-front">
        <path class="plate" d="M-6 6 L6 6 L4 34 L-4 34 Z" />
        <g class="shin">
          <path class="plate" d="M-4 34 L4 34 L3 58 L-3 58 Z" />
          <path class="plate" d="M-3 58 L10 58 L12 62 L-5 62 Z" />
          <circle class="joint" cx="0" cy="34" r="3" />
        </g>
        <circle class="joint" cx="0" cy="6" r="3" />
      </g>
      <g class="arm a-front">
        <path class="plate" d="M-4 -30 L4 -30 L3 -6 L-3 -6 Z" />
        <circle class="joint" cx="0" cy="-30" r="3" />
      </g>
      {!ghost && <circle class="joint core-light" cx="0" cy="-26" r="3.5" />}
    </g>
  );
}

function MotionScene({ frame }: { frame: number }) {
  const columns = Array.from({ length: 16 }, (_, k) => k);
  return (
    <svg viewBox="-100 -80 200 160" class="scene">
      <defs>
        <linearGradient id="w-rain-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="white" stop-opacity="0" />
          <stop offset="0.75" stop-color="white" stop-opacity="0.9" />
          <stop offset="1" stop-color="white" stop-opacity="1" />
        </linearGradient>
        <mask id="w-rain-mask" maskContentUnits="objectBoundingBox">
          <rect width="1" height="1" fill="url(#w-rain-fade)" />
        </mask>
        <filter id="w-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="w-screen">
          <rect x="-98" y="-78" width="196" height="156" rx="10" />
        </clipPath>
      </defs>
      <rect x="-98" y="-78" width="196" height="156" rx="10" class="screen" />
      <g clip-path="url(#w-screen)">
        {/* falling code */}
        <g class="rain">
          {columns.map((k) => (
            <text
              key={k}
              x={-92 + k * 12.2}
              y="-80"
              class={`drop${k % 5 === 2 ? " bright" : ""}`}
              style={{ animationDuration: `${2.2 + ((k * 7) % 5) * 0.55}s`, animationDelay: `${-((k * 13) % 9) * 0.4}s` }}
            >
              {rainColumn(k, 14)
                .split("")
                .map((ch, i) => (
                  <tspan key={i} x={-92 + k * 12.2} dy="9" class={i === 13 ? "head" : undefined}
                    style={{ opacity: ((i + 1) / 14) ** 1.6 }}>
                    {ch}
                  </tspan>
                ))}
            </text>
          ))}
        </g>
        {/* perspective grid floor */}
        <g class="grid">
          <line x1="-100" y1="62" x2="100" y2="62" class="horizon" />
          {[-80, -50, -25, 0, 25, 50, 80].map((x) => (
            <line key={x} x1={x * 0.4} y1="62" x2={x * 1.6} y2="80" />
          ))}
          <g class="grid-rows">
            {[0, 1, 2, 3].map((k) => (
              <line key={k} x1="-100" x2="100" y1={64 + k * 5} y2={64 + k * 5} />
            ))}
          </g>
        </g>
        {/* the walker, with motion trails */}
        <g filter="url(#w-glow)">
          <Walker lag={0.16} ghost />
          <Walker lag={0.08} ghost />
          <Walker lag={0} />
        </g>
        {/* tracking brackets that breathe around the body */}
        <g class="brackets">
          <path d="M-34 -66 L-34 -58 M-34 -66 L-26 -66" />
          <path d="M34 -66 L34 -58 M34 -66 L26 -66" />
          <path d="M-34 66 L-34 58 M-34 66 L-26 66" />
          <path d="M34 66 L34 58 M34 66 L26 66" />
        </g>
        <rect class="scanline" x="-98" y="-78" width="196" height="3" />
      </g>
      {/* readout */}
      <g class="hud">
        <text x="-90" y="-66">MOCAP // LIVE</text>
        <text x="90" y="-66" text-anchor="end">
          F {String(frame).padStart(5, "0")}
        </text>
        <text x="-90" y="74">TRACKING JOINTS</text>
        <rect class="rec" x="80" y="68.5" width="7" height="7" rx="3.5" />
      </g>
    </svg>
  );
}
