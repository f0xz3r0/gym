// The working preview for rig and motion steps: the creature itself as a 3D hologram (three.js). Glowing rim on a
// dark stage, its own skeleton inside with a light at every joint, a scan plane sweeping the body, a slow orbiting
// camera and bloom. With an animated model (an earlier motion result) it plays the animation; a still rig turns.
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** A gentle idle for a rig with no animation yet, from the bone names: breathing in the spine, a slow drift of the
 * neck and head, a tail sway that grows toward the tip, a small arm swing. Legs and hips stay put (feet planted). */
interface IdleBone { bone: THREE.Bone; rest: THREE.Quaternion; yaw: THREE.Vector3; pitch: THREE.Vector3;
  kind: "tail" | "neck" | "spine" | "arm"; index: number; side: number }

function idleBones(bones: THREE.Bone[]): IdleBone[] {
  const up = new THREE.Vector3(0, 1, 0);
  const out: IdleBone[] = [];
  const counters: Record<string, number> = {};
  for (const bone of bones) {
    const name = bone.name.toLowerCase();
    const kind = /tail/.test(name) ? "tail"
      : /neck|head|jaw|skull/.test(name) ? "neck"
      : /spine|chest|torso|back|ribs/.test(name) ? "spine"
      : /shoulder|clavicle|arm|elbow|hand|wrist|finger/.test(name) ? "arm"
      : null;
    if (!kind || !bone.parent) continue;
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const here = bone.getWorldPosition(new THREE.Vector3());
    const child = bone.children.find((c) => (c as THREE.Bone).isBone);
    const dir = child ? child.getWorldPosition(new THREE.Vector3()).sub(here) : new THREE.Vector3(0, 0, 1);
    let pitch = new THREE.Vector3().crossVectors(dir, up);
    if (pitch.lengthSq() < 1e-8) pitch = new THREE.Vector3(1, 0, 0);
    const key = kind + (/(\.|_)r\b|right/.test(name) ? "R" : "L");
    counters[key] = (counters[key] ?? 0) + 1;
    out.push({
      bone, kind, index: counters[key]! - 1,
      side: /(\.|_)r\b|right/.test(name) ? -1 : 1,
      rest: bone.quaternion.clone(),
      yaw: up.clone().applyQuaternion(parentQ).normalize(),
      pitch: pitch.normalize().applyQuaternion(parentQ).normalize(),
    });
  }
  return out;
}

/** The middle of the feet (world x, z): the foot, toe, ankle, paw and hoof bones' mean; without such bones, the mean of
 * the mesh points within 3 % of the height of the floor. */
function feetCentre(model: THREE.Object3D, floorY: number): THREE.Vector3 {
  const points: THREE.Vector3[] = [];
  model.traverse((node) => {
    if ((node as THREE.Bone).isBone && /foot|toe|ankle|paw|hoof/i.test(node.name))
      points.push(node.getWorldPosition(new THREE.Vector3()));
  });
  if (!points.length) {
    const box = new THREE.Box3().setFromObject(model);
    const limit = floorY + (box.max.y - box.min.y) * 0.03;
    const v = new THREE.Vector3();
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      const position = mesh.isMesh ? mesh.geometry.getAttribute("position") : undefined;
      if (!position) return;
      for (let k = 0; k < position.count; k += 7) {
        v.fromBufferAttribute(position, k).applyMatrix4(mesh.matrixWorld);
        if (v.y <= limit) points.push(v.clone());
      }
    });
  }
  if (!points.length) return new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  return points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
}

function applyIdle(list: IdleBone[], t: number) {
  const q = new THREE.Quaternion();
  for (const b of list) {
    b.bone.quaternion.copy(b.rest);
    let yaw = 0;
    let pitch = 0;
    if (b.kind === "tail") {
      yaw = Math.sin(t * 1.1 - b.index * 0.45) * (0.035 + 0.012 * b.index);
      pitch = Math.sin(t * 0.8 - b.index * 0.3) * 0.012;
    } else if (b.kind === "neck") {
      pitch = Math.sin(t * 0.7) * 0.025;
      yaw = Math.sin(t * 0.31 + 1) * 0.035;
    } else if (b.kind === "spine") {
      pitch = Math.sin(t * 1.5) * 0.012;
    } else {
      pitch = Math.sin(t * 1.1 + (b.side > 0 ? 0 : Math.PI)) * 0.04;
    }
    if (yaw) b.bone.quaternion.premultiply(q.setFromAxisAngle(b.yaw, yaw));
    if (pitch) b.bone.quaternion.premultiply(q.setFromAxisAngle(b.pitch, pitch));
  }
}

const CYAN = new THREE.Color("#35e8ff");
const DEEP = new THREE.Color("#0a3a66");
const JOINT = new THREE.Color("#7dffb0");

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vNormalV;
varying vec3 vView;
varying float vHeight;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vNormalV = normalize(transformedNormal);
  vView = normalize(-mvPosition.xyz);
  vHeight = (modelMatrix * vec4(transformed, 1.0)).y;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uDeep;
uniform float uTime;
uniform float uScan;
uniform float uHeight;
varying vec3 vNormalV;
varying vec3 vView;
varying float vHeight;
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vView)));
  float rim = pow(1.0 - facing, 2.4);
  float h = vHeight / max(uHeight, 1e-4);
  float lines = smoothstep(0.92, 1.0, fract(h * 70.0 - uTime * 0.6)) * 0.18;
  float scan = exp(-pow((h - uScan) * 28.0, 2.0));
  vec3 colour = mix(uDeep, uRim, rim) + uRim * (lines + scan * 1.6);
  float alpha = clamp(0.10 + rim * 0.85 + lines + scan * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(colour, alpha);
}`;

export function Holo3D({ url, onFail }: { url: string; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ joints: number; animated: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let frame = 0;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#03060b", 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#03060b", 0.32);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.22, 0.38);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const uniforms = {
      uRim: { value: CYAN },
      uDeep: { value: DEEP },
      uTime: { value: 0 },
      uScan: { value: 0 },
      uHeight: { value: 1 },
    };
    const holo = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    // floor: a fine grid fading into the fog, and a soft glow under the feet
    const grid = new THREE.GridHelper(8, 64, CYAN, CYAN);
    (grid.material as THREE.LineBasicMaterial).transparent = true;
    (grid.material as THREE.LineBasicMaterial).opacity = 0.09;
    scene.add(grid);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.02, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.002;
    scene.add(glow);

    // scan: a thin glowing ring that travels up and down the body
    const scanPlane = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 96),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    scanPlane.rotation.x = -Math.PI / 2;
    scanPlane.visible = false; // the scan band in the body shader reads better than a ring seen edge-on
    scene.add(scanPlane);

    let mixer: THREE.AnimationMixer | null = null;
    let model: THREE.Object3D | null = null;
    // turns happen on this pivot at the centre of the floor circle; the model sits in it, centred on its footprint
    const pivot = new THREE.Group();
    scene.add(pivot);
    const bones: THREE.Bone[] = [];
    let jointMesh: THREE.InstancedMesh | null = null;
    let boneLines: THREE.LineSegments | null = null;
    let size = 1;
    let animated = false;
    let baseYaw = 0; // turns the body so its long side faces the camera (a three-quarter view)
    let idle: IdleBone[] = [];
    const timer = new THREE.Clock();

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        // stand it on the floor, about 1.6 units tall (or long), with the middle of its feet on the pivot
        const box = new THREE.Box3().setFromObject(model);
        const dims = box.getSize(new THREE.Vector3());
        size = Math.max(dims.x, dims.y, dims.z) || 1;
        const scale = 1.6 / size;
        model.scale.setScalar(scale);
        model.position.set(0, -box.min.y * scale, 0);
        model.updateMatrixWorld(true);
        const feet = feetCentre(model, box.min.y * scale + model.position.y);
        model.position.x -= feet.x;
        model.position.z -= feet.z;
        uniforms.uHeight.value = dims.y * scale;
        baseYaw = dims.z >= dims.x ? Math.PI / 2 - 0.15 : -0.15;
        size = 1.6;
        const clip = gltf.animations[0];
        animated = !!clip;
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) {
            // a finished animation is shown as it is; a rig still being worked on, as a hologram
            if (!animated) mesh.material = holo;
            mesh.frustumCulled = false;
          }
          if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone);
        });
        pivot.add(model);
        model.updateMatrixWorld(true);
        if (animated) {
          // its own textures under studio light: no bloom, no skeleton, a softer stage
          const pmrem = new THREE.PMREMGenerator(renderer);
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          pmrem.dispose();
          scene.add(new THREE.HemisphereLight("#dfefff", "#1a1d22", 0.9));
          const sun = new THREE.DirectionalLight("#ffffff", 1.8);
          sun.position.set(2, 4, 3);
          scene.add(sun);
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.setClearColor("#15181d", 1);
          scene.fog = new THREE.FogExp2("#15181d", 0.12);
          bloom.enabled = false;
          (grid.material as THREE.LineBasicMaterial).color.set("#5b6470");
          glow.visible = false;
        } else {
          idle = idleBones(bones);
        }
        scanPlane.scale.setScalar(Math.max(dims.x, dims.z) * scale * 0.62);
        glow.scale.setScalar(Math.max(dims.x, dims.z) * scale * 0.45);

        if (bones.length && !animated) {
          jointMesh = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.012, 12, 12),
            new THREE.MeshBasicMaterial({ color: JOINT, depthTest: false, transparent: true }),
            bones.length,
          );
          jointMesh.renderOrder = 3;
          scene.add(jointMesh);
          const pairs = bones.filter((b) => (b.parent as THREE.Bone | null)?.isBone);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
          boneLines = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({ color: JOINT, transparent: true, opacity: 0.55, depthTest: false }),
          );
          boneLines.renderOrder = 2;
          boneLines.userData.pairs = pairs;
          scene.add(boneLines);
        }
        if (clip) {
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(clip).play();
        }
        setInfo({ joints: bones.length, animated: !!clip });
      },
      undefined,
      () => !disposed && onFail(),
    );

    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const tick = () => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      const dt = Math.min(timer.getDelta(), 0.05);
      const t = timer.elapsedTime;
      mixer?.update(dt);
      uniforms.uTime.value = t;
      const scan = (Math.sin(t * 0.9) * 0.5 + 0.5) * 1.05;
      uniforms.uScan.value = scan;
      scanPlane.position.y = scan * uniforms.uHeight.value;
      if (model && mixer) pivot.rotation.y = baseYaw;
      if (model && !mixer) {
        pivot.rotation.y = baseYaw + t * 0.35; // a slow full turn on the spot, about 18 s per revolution
        applyIdle(idle, t);
      }
      if (jointMesh) {
        bones.forEach((bone, k) => {
          bone.getWorldPosition(at);
          matrix.makeScale(1 + 0.25 * Math.sin(t * 4 + k), 1 + 0.25 * Math.sin(t * 4 + k), 1);
          matrix.setPosition(at);
          jointMesh!.setMatrixAt(k, matrix);
        });
        jointMesh.instanceMatrix.needsUpdate = true;
      }
      if (boneLines) {
        const pairs = boneLines.userData.pairs as THREE.Bone[];
        const pos = boneLines.geometry.getAttribute("position") as THREE.BufferAttribute;
        pairs.forEach((bone, k) => {
          bone.getWorldPosition(at);
          pos.setXYZ(k * 2, at.x, at.y, at.z);
          (bone.parent as THREE.Bone).getWorldPosition(at);
          pos.setXYZ(k * 2 + 1, at.x, at.y, at.z);
        });
        pos.needsUpdate = true;
      }
      // a slow orbit at three-quarter height; an animated model is watched from a steady side-front angle
      const orbit = mixer ? 0.6 + Math.sin(t * 0.2) * 0.35 : 0.6;
      const radius = size * (mixer ? 2.05 : 1.45);
      camera.position.set(Math.sin(orbit) * radius, uniforms.uHeight.value * 0.95, Math.cos(orbit) * radius);
      camera.lookAt(0, uniforms.uHeight.value * 0.45, 0);
      composer.render();
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose?.();
      });
      holo.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div class="holo">
      <div class="holo-canvas" ref={host} />
      <div class="holo-hud">
        <span>{info ? (info.animated ? "MOTION · PLAYBACK" : "RIG · SCAN") : "LOADING MODEL"}</span>
        <span>{info ? `${info.joints} JOINTS` : ""}</span>
      </div>
    </div>
  );
}
