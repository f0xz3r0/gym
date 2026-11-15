// Edit joints: the Animation rig step's auto-rig joints as dots on the model, seen from the front and the side; drag
// them onto the real joints, then "Build rig" rebuilds the skin, start pose and rig from them (a job of the
// Animation rig step with its hidden "joints" parameter: video2rig_service.py -> tools/v2r2.py rebuild). The Test
// panel bends the built rig through test poses. Backend: rig_editor.py (/api/rig-editor/<creature folder>).
//
// Coordinates: joints.json is in Blender space (Z up); the views are glTF (Y up): gltf = (x, z, -y).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { jobs, mergeJob } from "../state/store";
import { act, docs, ensureJobs, loadDoc, runStep, toast, worldOf } from "./state";
import { results, stepById } from "./steps";
import { JobProgress, Modal } from "./ui";

type Vec = [number, number, number];
interface Bone { name: string; head: Vec; tail: Vec; parent: string | null; role?: string }
interface Joints { body: string; facing: string; left: Vec; height: number; bones: Bone[] }
interface RigInfo {
  folder: string; joints: Joints; auto: Joints; has_reader: boolean; approved: boolean;
  joints_edited: string | null; rig_sha1: string | null;
}
type Side = "left" | "right" | "middle";
interface Dot { id: string; bone: string; end: "head" | "tail"; pos: Vec; side: Side }

const toGl = (v: Vec) => new THREE.Vector3(v[0], v[2], -v[1]);
const fromGl = (v: THREE.Vector3): Vec => [v.x, -v.z, v.y];
const FACING: Record<string, Vec> = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0] };
const sideOf = (name: string): Side => (/[._-]L$|Left/.test(name) ? "left" : /[._-]R$|Right/.test(name) ? "right" : "middle");
const partner = (name: string) =>
  /[._-]L$/.test(name) ? name.slice(0, -1) + "R"
    : /[._-]R$/.test(name) ? name.slice(0, -1) + "L"
    : name.includes("Left") ? name.replace("Left", "Right")
    : name.replace("Right", "Left");
const same = (a: Vec, b: Vec) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0)))) < 1e-5;
const clone = (bones: Bone[]) => bones.map((b) => ({ ...b, head: [...b.head] as Vec, tail: [...b.tail] as Vec }));

/** Which child continues each bone (its tail sits on that child's head), from the auto-rig's own joints. */
function connections(bones: Bone[]) {
  const next = new Map<string, string>();
  for (const bone of bones) {
    const child = bones.find((c) => c.parent === bone.name && same(c.head, bone.tail));
    if (child) next.set(bone.name, child.name);
  }
  return next;
}

function dotsOf(bones: Bone[], next: Map<string, string>): Dot[] {
  const dots: Dot[] = [];
  for (const bone of bones) {
    if (bone.role === "root" || bone.parent === null) continue;
    dots.push({ id: `${bone.name}:head`, bone: bone.name, end: "head", pos: bone.head, side: sideOf(bone.name) });
    if (!next.has(bone.name))
      dots.push({ id: `${bone.name}:tail`, bone: bone.name, end: "tail", pos: bone.tail, side: sideOf(bone.name) });
  }
  return dots;
}

/** Move one dot (and with Mirror its partner on the other side). A head drags the parent's tail with it. */
function moved(bones: Bone[], next: Map<string, string>, dot: Dot, pos: Vec, mirror: { centre: Vec; left: Vec } | null) {
  const out = clone(bones);
  const place = (name: string, end: "head" | "tail", p: Vec) => {
    const bone = out.find((b) => b.name === name);
    if (!bone) return;
    bone[end] = p;
    if (end === "head" && bone.parent) {
      const parent = out.find((b) => b.name === bone.parent);
      if (parent && next.get(parent.name) === name) parent.tail = p;
    }
  };
  place(dot.bone, dot.end, pos);
  if (mirror && dot.side !== "middle") {
    const other = partner(dot.bone);
    if (other !== dot.bone && out.some((b) => b.name === other)) {
      const { centre, left } = mirror;
      const d = pos.reduce((s, v, i) => s + (v - (centre[i] ?? 0)) * (left[i] ?? 0), 0);
      place(other, dot.end, pos.map((v, i) => v - 2 * d * (left[i] ?? 0)) as Vec);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the page

export function JointEditor({ docId, folder }: { docId: string; folder: string }) {
  const doc = docs.value.get(docId);
  useEffect(() => {
    if (!doc) void loadDoc(docId).catch(() => undefined);
  }, [docId]);
  const [info, setInfo] = useState<RigInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bones, setBones] = useState<Bone[]>([]);
  const [history, setHistory] = useState<Bone[][]>([]);
  const [mirror, setMirror] = useState(true);
  const [viewKey, setViewKey] = useState(0);
  const [buildJob, setBuildJob] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [version, setVersion] = useState(0);

  const load = async () => {
    const response = await fetch(`/api/rig-editor/${encodeURIComponent(folder)}`);
    if (!response.ok) {
      setError(((await response.json().catch(() => ({}))) as { detail?: string }).detail ?? "This rig could not be read.");
      return;
    }
    const data = (await response.json()) as RigInfo;
    setInfo(data);
    setBones(clone(data.joints.bones));
    setHistory([]);
    setVersion((v) => v + 1);
  };
  useEffect(() => void load(), [folder]);

  const next = useMemo(() => (info ? connections(info.auto.bones) : new Map<string, string>()), [info]);
  const frame = useMemo(() => {
    if (!info) return null;
    const hips = info.joints.bones.find((b) => b.role === "trunk") ?? info.joints.bones[0];
    if (!hips) return null;
    const left = info.joints.left;
    const facing = FACING[info.joints.facing] ?? [0, -1, 0];
    return { centre: hips.head, left, facing };
  }, [info]);
  const dots = useMemo(() => dotsOf(bones, next), [bones, next]);
  const dirty = info ? bones.some((b, i) => { const o = info.joints.bones[i]; return !o || !same(b.head, o.head) || !same(b.tail, o.tail); }) : false;

  // the Animation rig result that made this rig: its job's mesh input is what Build rig runs on again
  const step = stepById("animrig");
  const source = doc && step
    ? results(worldOf(doc), step).filter((r) => (r.asset.meta as Record<string, unknown> | undefined)?.creature_folder === folder).at(-1)
    : undefined;
  useEffect(() => {
    if (doc) ensureJobs(doc.steps.animrig?.jobs ?? []);
  }, [doc?.rev]);

  const job = buildJob ? jobs.value.get(buildJob) : undefined;
  const building = job !== undefined && !["succeeded", "failed", "cancelled"].includes(job.status);
  useEffect(() => {
    if (job?.status === "succeeded") {
      toast("Rig rebuilt from your joints. It is the newest Animation rig result.", "good");
      setBuildJob(null);
      void load();
    }
  }, [job?.status]);

  const begin = () => setHistory((h) => [...h.slice(-49), clone(bones)]);
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setBones(last);
    setHistory((h) => h.slice(0, -1));
  };
  const resetToAuto = () => {
    if (!info) return;
    begin();
    setBones(clone(info.auto.bones));
  };
  const move = (dot: Dot, pos: Vec) => setBones((current) => moved(current, next, dot, pos, mirror && frame ? frame : null));

  const build = () =>
    act(async () => {
      setConfirm(false);
      if (!doc || !step || !source?.job) throw new Error("The Animation rig result for this rig was not found.");
      const mesh = source.job.inputs.mesh;
      if (typeof mesh !== "string") throw new Error("The Animation rig job has no model input.");
      const joints = JSON.stringify({ folder, bones: bones.map(({ name, head, tail }) => ({ name, head, tail })) });
      const created = await runStep(doc, step, 1, { joints }, { mesh });
      created.forEach(mergeJob);
      setBuildJob(created[0]?.id ?? null);
      toast("Building the rig from your joints…", "info");
    });

  if (error)
    return (
      <div class="page narrow">
        <h1>Edit joints</h1>
        <p class="note error">{error}</p>
        <a class="button" href={`#/a/${encodeURIComponent(docId)}`}>Back</a>
      </div>
    );
  if (!info || !frame) return <div class="page center"><span class="spinner" /></div>;

  return (
    <div class="joint-editor">
      <div class="je-toolbar">
        <a class="back" href={`#/a/${encodeURIComponent(docId)}`}>← {doc?.name ?? "Asset"}</a>
        <b class="je-title">Edit joints</b>
        <span class="muted small">{info.joints.body} · {bones.length} bones</span>
        <label class="je-check" title="Moving a left or right joint moves its partner on the other side too">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror((e.target as HTMLInputElement).checked)} /> Mirror
        </label>
        <button class="button small" onClick={undo} disabled={!history.length}>Undo</button>
        <button class="button small" onClick={resetToAuto}
          title="Put every dot back where the auto-rig (UniRig) placed it">Reset to auto-rig</button>
        <button class="button small ghost" onClick={() => setViewKey((k) => k + 1)}>Reset views</button>
        <span class="spacer" />
        {building ? (
          <JobProgress job={job} typical="about 3 min" />
        ) : (
          <button class="button small primary" disabled={!dirty || !source}
            title={!source ? "The Animation rig result for this rig was not found" : dirty ? "Rebuild skin, start pose and rig from these joints" : "Move a dot first"}
            onClick={() => (info.has_reader ? setConfirm(true) : void build())}>
            Build rig
          </button>
        )}
      </div>
      {job?.status === "failed" && <p class="note error je-note">Build rig failed: {job.error_message}</p>}
      <div class="je-panels">
        <JointView key={`front-${viewKey}-${version}`} kind="front" folder={folder} rigSha={info.rig_sha1} frame={frame} dots={dots} bones={bones}
          onBegin={begin} onMove={move} />
        <JointView key={`side-${viewKey}-${version}`} kind="side" folder={folder} rigSha={info.rig_sha1} frame={frame} dots={dots} bones={bones}
          onBegin={begin} onMove={move} />
        <TestView key={`test-${info.rig_sha1}`} folder={folder} info={info} dirty={dirty} />
      </div>
      {confirm && (
        <Modal title="Build rig" onClose={() => setConfirm(false)}>
          <p>
            This rig already has a trained <b>Motion reader</b>. It learned the old joints, so it is set aside and the
            Motion reader step has to train again (about 20 min) before new motion videos can be fitted.
          </p>
          <div class="row" style={{ justifyContent: "flex-end", marginTop: "16px" }}>
            <button class="button" onClick={() => setConfirm(false)}>Cancel</button>
            <button class="button primary" onClick={() => void build()}>Build rig</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ front / side view with draggable dots

const loader = new GLTFLoader();

function JointView({ kind, folder, rigSha, frame, dots, bones, onBegin, onMove }: {
  kind: "front" | "side"; folder: string; rigSha: string | null; frame: { centre: Vec; left: Vec; facing: Vec }; dots: Dot[]; bones: Bone[];
  onBegin: () => void; onMove: (dot: Dot, pos: Vec) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; size: number; tall: number; wide: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ dot: Dot; x: number; y: number; start: Vec } | { pan: true; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const centre = toGl(frame.centre);
    const facing = toGl(frame.facing).normalize();
    const left = toGl(frame.left).normalize();
    // front: in front of the model, looking at it; side: on its left, so it faces left on screen
    const out = kind === "front" ? facing : left;
    const state = { renderer, scene, camera, size: 2, tall: 2, wide: 2 };
    three.current = state;
    const place = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      // fit the model's height and its width across the view, whichever needs more room
      const half = Math.max(state.tall / 2, state.wide / 2 / (w / h)) * 1.12;
      camera.left = (-half * w) / h; camera.right = (half * w) / h; camera.top = half; camera.bottom = -half;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      setTick((t) => t + 1);
    };
    camera.position.copy(centre).addScaledVector(out, 10);
    camera.up.set(0, 1, 0);
    camera.lookAt(centre);
    sun.position.copy(out).multiplyScalar(5).add(new THREE.Vector3(0, 4, 0));
    scene.add(sun);
    // the built rig (textured) in its rest pose, where the joints are defined; the auto-rig's plain model if the rig
    // cannot be read
    const shown = (gltf: { scene: THREE.Object3D }) => {
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.pose();
      });
      gltf.scene.updateMatrixWorld(true);
      scene.add(gltf.scene);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      // its extent across this view: along the side axis from the front, along the facing axis from the side
      const across = kind === "front" ? left : facing;
      const corners = [box.min, box.max];
      const spread = (axis: THREE.Vector3) => {
        const values = corners.flatMap((a) => corners.flatMap((b) => corners.map((c) => new THREE.Vector3(a.x, b.y, c.z).dot(axis))));
        return Math.max(...values) - Math.min(...values);
      };
      state.tall = size.y;
      state.wide = spread(across);
      state.size = Math.max(state.tall, state.wide);
      // look at the model's middle, at the same depth as before
      const along = camera.position.clone().sub(centre).dot(out);
      const target = mid.clone();
      camera.position.copy(target).addScaledVector(out, along);
      camera.lookAt(target);
      place();
    };
    const plain = () => loader.load(`/api/rig-editor/${encodeURIComponent(folder)}/model.glb`, shown);
    loader.load(`/api/rig-editor/${encodeURIComponent(folder)}/rig.glb?v=${rigSha ?? ""}`, shown, undefined, plain);
    const observer = new ResizeObserver(place);
    observer.observe(el);
    place();
    return () => {
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  const state = three.current;
  const el = host.current;
  const width = el?.clientWidth ?? 1, height = el?.clientHeight ?? 1;
  const project = (v: Vec) => {
    if (!state) return { x: 0, y: 0, depth: 0 };
    state.camera.updateMatrixWorld();
    const p = toGl(v);
    const depth = p.clone().sub(state.camera.position).dot(state.camera.getWorldDirection(new THREE.Vector3()));
    p.project(state.camera);
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height, depth };
  };
  // pixels -> world: the camera's right and up axes scaled by the visible width per pixel
  const worldPerPixel = () => (state ? (state.camera.right - state.camera.left) / state.camera.zoom / width : 0);
  const axes = () => {
    const m = state ? state.camera.matrixWorld.elements : new THREE.Matrix4().elements;
    return { right: new THREE.Vector3(m[0], m[1], m[2]), up: new THREE.Vector3(m[4], m[5], m[6]) };
  };
  if (tick < 0) return null; // re-rendered on camera changes

  const redraw = () => {
    if (state) state.renderer.render(state.scene, state.camera);
    setTick((t) => t + 1);
  };
  const onWheel = (event: WheelEvent) => {
    if (!state || !el) return;
    event.preventDefault();
    const box = el.getBoundingClientRect();
    const { right, up } = axes();
    const before = worldPerPixel();
    const dx = event.clientX - box.left - width / 2, dy = event.clientY - box.top - height / 2;
    state.camera.zoom = Math.min(20, Math.max(0.4, state.camera.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    state.camera.updateProjectionMatrix();
    const after = worldPerPixel();
    // keep the point under the cursor in place
    state.camera.position.addScaledVector(right, dx * (before - after)).addScaledVector(up, -dy * (before - after));
    redraw();
  };
  const onDown = (event: PointerEvent, dot?: Dot) => {
    if (!state) return;
    if (event.button === 2 || (event.button === 0 && !dot)) {
      drag.current = { pan: true, x: event.clientX, y: event.clientY };
    } else if (dot && event.button === 0) {
      onBegin();
      drag.current = { dot, x: event.clientX, y: event.clientY, start: dot.pos };
    } else return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };
  const onMoveEvent = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || !state) return;
    const { right, up } = axes();
    const k = worldPerPixel();
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if ("pan" in current) {
      state.camera.position.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      current.x = event.clientX; current.y = event.clientY;
      redraw();
      return;
    }
    const p = toGl(current.start).addScaledVector(right, dx * k).addScaledVector(up, -dy * k);
    onMove(current.dot, fromGl(p));
  };
  const onUp = () => { drag.current = null; };

  const colour: Record<Side, string> = { left: "var(--je-left)", right: "var(--je-right)", middle: "var(--je-middle)" };
  const byName = new Map(bones.map((b) => [b.name, b]));
  const shown = dots.map((dot) => ({ dot, ...project(dot.pos) })).sort((a, b) => b.depth - a.depth);
  const nearest = shown.length ? Math.min(...shown.map((s) => s.depth)) : 0;
  const farthest = shown.length ? Math.max(...shown.map((s) => s.depth)) : 0;
  const far = (depth: number) => kind === "side" && farthest - nearest > 0.01 && depth > (nearest + farthest) / 2;
  const hovered = shown.find((s) => s.dot.id === hover);

  return (
    <section class="je-panel">
      <header class="je-panel-head">
        <b>{kind === "front" ? "FRONT" : "SIDE"}</b>
        {kind === "front" ? (
          <span class="je-legend">
            <i style={{ background: "var(--je-left)" }} /> left <i style={{ background: "var(--je-right)" }} /> right{" "}
            <i style={{ background: "var(--je-middle)" }} /> middle
          </span>
        ) : (
          <span class="muted small">model faces left · far side faded</span>
        )}
      </header>
      <div class="je-canvas" ref={host} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => onDown(e)} onPointerMove={onMoveEvent} onPointerUp={onUp} onPointerCancel={onUp}>
        <svg class="je-overlay" width={width} height={height}>
          {bones.map((bone) => {
            if (bone.role === "root" || bone.parent === null) return null;
            const a = project(bone.head), b = project(bone.tail);
            const parent = bone.parent ? byName.get(bone.parent) : undefined;
            const link = parent && parent.role !== "root" && !same(parent.tail, bone.head) ? project(parent.head) : null;
            const stroke = colour[sideOf(bone.name)];
            const faded = far((a.depth + b.depth) / 2);
            return (
              <g key={bone.name} opacity={faded ? 0.35 : 1}>
                {link && <line x1={link.x} y1={link.y} x2={a.x} y2={a.y} stroke={stroke} stroke-width={1.5} stroke-dasharray="3 3" />}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} stroke-width={2} />
              </g>
            );
          })}
          {shown.map(({ dot, x, y, depth }) => (
            <circle key={dot.id} class={`je-dot${hover === dot.id ? " is-hover" : ""}`} cx={x} cy={y} r={hover === dot.id ? 7 : 5.5}
              fill={colour[dot.side]} opacity={far(depth) ? 0.4 : 1}
              onPointerDown={(e) => onDown(e, dot)}
              onPointerEnter={() => setHover(dot.id)} onPointerLeave={() => setHover(null)}>
              <title>{dot.end === "tail" ? `${dot.bone} (tip)` : dot.bone}</title>
            </circle>
          ))}
          {hovered && (
            <text class="je-label" x={hovered.x + 10} y={hovered.y - 10}>
              {hovered.dot.end === "tail" ? `${hovered.dot.bone} tip` : hovered.dot.bone}
            </text>
          )}
        </svg>
      </div>
      <footer class="je-hint">
        {kind === "front" ? "Drag dots onto the joints · wheel zoom · right-drag or drag empty space to pan" : "Same dots seen from the side"}
      </footer>
    </section>
  );
}

// ------------------------------------------------------------------ test: the built rig bending through poses

const sanitize = (name: string) => name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");

interface Turn { bone: THREE.Bone; axis: THREE.Vector3; angle: number }
interface Pose { name: string; turns: Turn[] }

function TestView({ folder, info, dirty }: { folder: string; info: RigInfo; dirty: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [skeleton, setSkeleton] = useState(false);
  const [paused, setPaused] = useState(false);
  const [poseName, setPoseName] = useState("");
  const [missing, setMissing] = useState(false);
  const flags = useRef({ skeleton: false, paused: false, helper: null as THREE.SkeletonHelper | null });
  flags.current.skeleton = skeleton;
  flags.current.paused = paused;
  if (flags.current.helper) flags.current.helper.visible = skeleton;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const grid = new THREE.GridHelper(4, 16, 0x888888, 0x555555);
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    let poses: Pose[] = [];
    let rest = new Map<THREE.Bone, THREE.Quaternion>();
    let order: THREE.Bone[] = [];
    let frameId = 0;
    let clock = 0;
    let last = performance.now();
    let shownPose = "";

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    loader.load(`/api/rig-editor/${encodeURIComponent(folder)}/rig.glb?v=${info.rig_sha1 ?? ""}`, (gltf) => {
      const model = gltf.scene;
      scene.add(model);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      grid.position.y = box.min.y;
      const facing = toGl(FACING[info.joints.facing] ?? [0, -1, 0]).normalize();
      const left = toGl(info.joints.left).normalize();
      const reach = Math.max(size.x, size.y, size.z);
      camera.position.copy(mid).addScaledVector(facing, reach * 1.9).addScaledVector(left, reach * 0.9).add(new THREE.Vector3(0, reach * 0.25, 0));
      controls.target.copy(mid);
      controls.update();
      const helper = new THREE.SkeletonHelper(model);
      helper.visible = flags.current.skeleton;
      flags.current.helper = helper;
      scene.add(helper);

      const bonesByName = new Map<string, THREE.Bone>();
      model.traverse((object) => {
        if (object instanceof THREE.Bone) bonesByName.set(object.name, object as THREE.Bone);
      });
      const find = (name: string) => bonesByName.get(sanitize(name)) ?? bonesByName.get(name);
      const spec = info.joints.bones;
      const role = new Map(spec.map((b) => [b.name, b.role ?? ""]));
      // chains: the bones of one limb, top first
      const chain = (top: string) => {
        const out = [top];
        for (;;) {
          const child = spec.find((b) => b.parent === out.at(-1) && role.get(b.name) === role.get(top));
          if (!child) return out;
          out.push(child.name);
        }
      };
      const limbTops = (roles: string[]) =>
        spec.filter((b) => roles.includes(role.get(b.name) ?? "") && role.get(b.parent ?? "") !== role.get(b.name)).map((b) => chain(b.name));
      const arms = limbTops(["arm"]);
      const legs = limbTops(["biped", "hind", "front", "leg"]);
      const trunk = spec.filter((b) => b.role === "trunk" && b.parent && role.get(b.parent) === "trunk").map((b) => b.name);
      const neck = spec.filter((b) => b.role === "neck" || b.role === "head").map((b) => b.name);
      const tail = spec.filter((b) => b.role === "tail").map((b) => b.name);
      model.updateMatrixWorld(true);
      // the sign that moves the bone's child towards `toward` (a rest-pose test)
      const signed = (bone: THREE.Bone, axis: THREE.Vector3, angle: number, toward: THREE.Vector3): Turn => {
        const child = bone.children.find((c) => c instanceof THREE.Bone);
        if (!child) return { bone, axis, angle };
        const before = child.getWorldPosition(new THREE.Vector3());
        const saved = bone.quaternion.clone();
        applyTurn({ bone, axis, angle: 0.2 });
        model.updateMatrixWorld(true);
        const after = child.getWorldPosition(new THREE.Vector3());
        bone.quaternion.copy(saved);
        model.updateMatrixWorld(true);
        return { bone, axis, angle: after.sub(before).dot(toward) >= 0 ? angle : -angle };
      };
      const up = new THREE.Vector3(0, 1, 0);
      const rad = THREE.MathUtils.degToRad;
      const pick = (names: string[]) => names.map(find).filter((b): b is THREE.Bone => b !== undefined);
      const upper = (limb: string[]) => { const n = limb.length >= 3 ? limb[1] : limb[0]; return n ? find(n) : undefined; };
      const lower = (limb: string[]) => { const n = limb.length >= 3 ? limb[2] : (limb[1] ?? limb[0]); return n ? find(n) : undefined; };
      const real = (b: THREE.Bone | undefined): b is THREE.Bone => b !== undefined;
      const list: Pose[] = [
        { name: "Arms up", turns: arms.map(upper).filter(real).map((b) => signed(b, facing, rad(70), up)) },
        { name: "Arms forward", turns: arms.map(upper).filter(real).map((b) => signed(b, left, rad(70), facing)) },
        { name: "Elbows bent", turns: arms.map(lower).filter(real).map((b) => signed(b, left, rad(90), facing)) },
        {
          name: "Squat",
          turns: legs.flatMap((limb) => {
            const top = limb[0] ? find(limb[0]) : undefined, knee = limb[1] ? find(limb[1]) : undefined;
            return [top && signed(top, left, rad(55), facing), knee && signed(knee, left, rad(95), facing.clone().negate())]
              .filter((t): t is Turn => Boolean(t));
          }),
        },
        { name: "Bend forward", turns: pick(trunk).map((b) => signed(b, left, rad(14), facing)) },
        { name: "Twist", turns: pick(trunk).map((b) => ({ bone: b, axis: up, angle: rad(14) })) },
        { name: "Head turn", turns: pick(neck).map((b) => ({ bone: b, axis: up, angle: rad(28) })) },
        { name: "Tail swing", turns: pick(tail).map((b) => ({ bone: b, axis: up, angle: rad(14) })) },
      ];
      poses = list.filter((pose) => pose.turns.length);
      rest = new Map([...bonesByName.values()].map((b) => [b, b.quaternion.clone()]));
      const depth = (b: THREE.Object3D) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };
      order = [...bonesByName.values()].sort((a, b) => depth(a) - depth(b));
    }, undefined, () => setMissing(true));

    // rotate a bone about a world axis, on top of its current local rotation
    const applyTurn = (turn: Turn, weight = 1) => {
      const parentQ = new THREE.Quaternion();
      turn.bone.parent?.getWorldQuaternion(parentQ);
      const delta = new THREE.Quaternion().setFromAxisAngle(turn.axis, turn.angle * weight);
      const local = parentQ.clone().invert().multiply(delta).multiply(parentQ);
      turn.bone.quaternion.premultiply(local);
    };

    const PERIOD = 2.6;
    const loop = () => {
      frameId = requestAnimationFrame(loop);
      const now = performance.now();
      if (!flags.current.paused && !document.hidden) clock += (now - last) / 1000;
      last = now;
      if (poses.length) {
        const index = Math.floor(clock / PERIOD) % poses.length;
        const phase = (clock % PERIOD) / PERIOD;
        const weight = Math.sin(Math.PI * Math.min(1, phase * 1.15)) ** 2;
        for (const bone of order) { const q = rest.get(bone); if (q) bone.quaternion.copy(q); }
        const pose = poses[index];
        if (!pose) return;
        for (const bone of order) {
          for (const turn of pose.turns) if (turn.bone === bone) { bone.updateMatrixWorld(true); applyTurn(turn, weight); }
        }
        if (pose.name !== shownPose) { shownPose = pose.name; setPoseName(pose.name); }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section class="je-panel">
      <header class="je-panel-head">
        <b>TEST</b>
        <span class="muted small">{poseName || "bend test"}</span>
        <span class="spacer" />
        <button class="button small" onClick={() => setPaused((p) => !p)}>{paused ? "Play" : "Pause"}</button>
        <label class="je-check">
          <input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton((e.target as HTMLInputElement).checked)} /> Skeleton
        </label>
      </header>
      <div class="je-canvas" ref={host}>
        {missing && <p class="muted je-empty">This rig has not been built yet.</p>}
        {dirty && <span class="je-badge">Shows the rig as last built: press Build rig to see your changes</span>}
      </div>
      <footer class="je-hint">Drag to orbit · wheel zoom · right-drag pan</footer>
    </section>
  );
}
