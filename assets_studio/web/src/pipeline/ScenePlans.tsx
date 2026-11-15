// Scene planning: the list of scene plans, and one plan's page (description, gameplay loop, concept images and the
// assets the scene needs, each of which can become a game asset).
import { useEffect, useRef, useState } from "preact/hooks";

import { assetById } from "../state/store";
import type { Kind } from "./api";
import { AssetCover, assetProgress, MiniSteps } from "./Home";
import { Picker } from "./Picker";
import { Thumb } from "./Preview";
import {
  addConceptFiles,
  createScene,
  deleteScene,
  ensureAssets,
  loadScene,
  loadScenes,
  makeGameAsset,
  newKey,
  type PlannedAsset,
  type Scene,
  sceneBrief,
  scenes,
  scenesLoaded,
  suggestAssets,
  type Suggestion,
  updateScene,
} from "./scenes";
import { act, allJobIds, docs, docsLoaded, ensureJobs, toast } from "./state";
import { KINDS, type ReferenceMode } from "./steps";
import { ConfirmButton, Modal, plural, ProgressBar, type Progress, useElapsed } from "./ui";

// ------------------------------------------------------------------ list

export function ScenesHome() {
  const [creating, setCreating] = useState(false);
  useEffect(() => void act(loadScenes), []);
  const list = [...scenes.value.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  useEffect(() => ensureAssets(list.map((scene) => scene.concepts[0]?.asset)), [list.length]);
  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Scenes</h1>
          <p class="muted">
            Plan a game scene before making its assets: describe it, write the gameplay loop, add concept images,
            then list the models it needs and make each one as a game asset.
          </p>
        </div>
        <button class="button primary" onClick={() => setCreating(true)}>
          + New scene
        </button>
      </header>
      {!scenesLoaded.value ? (
        <div class="center"><span class="spinner" /></div>
      ) : list.length === 0 ? (
        <div class="empty">
          <h2>Plan your first scene</h2>
          <p>
            For example <i>Garbage Day</i>: a suburban street where the garbage man collects every bin, squishes the
            load and hops on the truck. The plan turns into a checklist of game assets.
          </p>
          <button class="button primary" onClick={() => setCreating(true)}>
            + New scene
          </button>
        </div>
      ) : (
        <div class="cards">
          {list.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}
        </div>
      )}
      {creating && <NewScene onClose={() => setCreating(false)} />}
    </div>
  );
}

function SceneCard({ scene }: { scene: Scene }) {
  const cover = scene.concepts[0] ? assetById(scene.concepts[0].asset) : undefined;
  const made = scene.assets.filter((row) => row.game_asset && docs.value.has(row.game_asset)).length;
  const beats = scene.loop.filter((beat) => beat.trim()).length;
  return (
    <a class="card" href={`#/s/${scene.id}`}>
      <span class="card-image">
        {cover ? <Thumb asset={cover} /> : <span class="card-placeholder">{scene.name.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span class="card-body">
        <b>{scene.name}</b>
        <span class="card-line">
          {plural(beats, "beat")} · {plural(scene.assets.length, "asset")}
          {scene.assets.length > 0 && ` · ${made} made`}
        </span>
      </span>
    </a>
  );
}

function NewScene({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const scene = await act(() => createScene(name.trim(), description.trim()));
    setBusy(false);
    if (scene) {
      onClose();
      window.location.hash = `#/s/${scene.id}`;
    }
  };
  return (
    <Modal title="New scene" onClose={onClose}>
      <label class="field">
        <span>Name</span>
        <input value={name} placeholder="e.g. Garbage Day" onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      <label class="field">
        <span>What is the scene? (you can add more later)</span>
        <textarea
          rows={4}
          value={description}
          placeholder="A sunny suburban street on garbage day. Bins and bags wait at the curb of every house…"
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <footer class="modal-actions">
        <button class="button ghost" onClick={onClose}>
          Cancel
        </button>
        <button class="button primary" disabled={!name.trim() || busy} onClick={() => void create()}>
          {busy ? "Creating…" : "Create"}
        </button>
      </footer>
    </Modal>
  );
}

// ------------------------------------------------------------------ one plan

/** Text that saves itself when you leave the field. */
function SavedText({
  value,
  onSave,
  rows,
  placeholder,
  class: className,
  label,
}: {
  value: string;
  onSave: (text: string) => unknown;
  rows?: number;
  placeholder?: string;
  class?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const common = {
    value: draft,
    placeholder,
    class: className,
    "aria-label": label,
    onFocus: () => (editing.current = true),
    onInput: (event: Event) => setDraft((event.currentTarget as HTMLInputElement).value),
    onBlur: () => {
      editing.current = false;
      if (draft !== value) void act(async () => onSave(draft));
    },
  };
  return rows ? <textarea rows={rows} {...common} /> : <input {...common} />;
}

export function ScenePage({ id }: { id: string }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void loadScene(id).catch(() => setMissing(true));
  }, [id]);
  const scene = scenes.value.get(id);
  const linked = scene ? scene.assets.map((row) => row.game_asset).filter((x): x is string => !!x) : [];
  useEffect(() => {
    if (!scene) return;
    ensureAssets([...scene.concepts.map((c) => c.asset), ...scene.assets.map((row) => row.concept)]);
    ensureJobs(linked.flatMap((docId) => (docs.value.get(docId) ? allJobIds(docs.value.get(docId)!) : [])));
  }, [scene?.rev, docs.value.size]);
  if (missing)
    return (
      <div class="page">
        <p>
          This scene plan no longer exists. <a href="#/scenes">Back to scenes</a>
        </p>
      </div>
    );
  if (!scene)
    return (
      <div class="page">
        <div class="center"><span class="spinner" /></div>
      </div>
    );
  const save = (change: (next: Scene) => void) => updateScene(id, change);
  return (
    <div class="page scene-page">
      <a class="back-link" href="#/scenes">← Scenes</a>
      <header class="page-head">
        <SavedText class="scene-title" label="Scene name" value={scene.name} onSave={(text) => save((s) => void (s.name = text.trim() || s.name))} />
        <div class="row-actions">
          <button
            class="button"
            title="Copy the plan as text, to paste into a chat, a design doc or a project README"
            onClick={() =>
              void navigator.clipboard.writeText(sceneBrief(scene)).then(
                () => toast("Plan copied as text", "good"),
                () => toast("The browser did not allow copying.", "error"),
              )
            }
          >
            Copy as text
          </button>
          <ConfirmButton
            class="ghost"
            label="Delete plan"
            confirm="Delete this plan? (its images and game assets stay)"
            onConfirm={() =>
              void act(async () => {
                await deleteScene(id);
                window.location.hash = "#/scenes";
              })
            }
          />
        </div>
      </header>

      <div class="scene-grid">
        <div class="scene-col">
          <section class="panel">
            <h2>The scene</h2>
            <p class="muted small">Where it is, what's in it, the mood, time of day, camera and art style.</p>
            <SavedText
              rows={7}
              label="Scene description"
              value={scene.description}
              placeholder="A sunny suburban street on garbage day. Four houses with driveways on one side…"
              onSave={(text) => save((s) => void (s.description = text))}
            />
          </section>
          <LoopEditor scene={scene} />
          <section class="panel">
            <h2>Rules</h2>
            <label class="field">
              <span>How it's won (or lost)</span>
              <SavedText
                rows={2}
                value={scene.win}
                placeholder="Every bag and bin is in the truck, squished, and he is riding on the back step."
                onSave={(text) => save((s) => void (s.win = text))}
              />
            </label>
            <label class="field">
              <span>Controls</span>
              <SavedText
                rows={2}
                value={scene.controls}
                placeholder="WASD walk, Space jump, E pick up / toss / pull lever / hop on"
                onSave={(text) => save((s) => void (s.controls = text))}
              />
            </label>
            <label class="field">
              <span>Notes</span>
              <SavedText
                rows={3}
                value={scene.notes}
                placeholder="Anything else: sounds, a timer, ideas for later…"
                onSave={(text) => save((s) => void (s.notes = text))}
              />
            </label>
          </section>
        </div>
        <div class="scene-col">
          <ConceptBoard scene={scene} />
        </div>
      </div>

      <AssetPlan scene={scene} />
    </div>
  );
}

// ------------------------------------------------------------------ loop

function LoopEditor({ scene }: { scene: Scene }) {
  const save = (change: (next: Scene) => void) => act(() => updateScene(scene.id, change));
  const move = (from: number, to: number) =>
    save((s) => {
      const [beat] = s.loop.splice(from, 1);
      s.loop.splice(to, 0, beat ?? "");
    });
  return (
    <section class="panel">
      <h2>Gameplay loop</h2>
      <p class="muted small">What the player does, step by step, from the start to the end of the scene.</p>
      <ol class="loop-list">
        {scene.loop.map((beat, index) => (
          <li key={`${index}-${scene.loop.length}`} class="loop-beat">
            <span class="loop-num">{index + 1}</span>
            <SavedText
              label={`Beat ${index + 1}`}
              value={beat}
              placeholder="e.g. Pick up a bag at the curb"
              onSave={(text) => updateScene(scene.id, (s) => void (s.loop[index] = text))}
            />
            <span class="loop-tools">
              <button class="icon-button" title="Move up" disabled={index === 0} onClick={() => void move(index, index - 1)}>
                ▲
              </button>
              <button
                class="icon-button"
                title="Move down"
                disabled={index === scene.loop.length - 1}
                onClick={() => void move(index, index + 1)}
              >
                ▼
              </button>
              <button class="icon-button" title="Remove" onClick={() => void save((s) => void s.loop.splice(index, 1))}>
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button class="button small" onClick={() => void save((s) => void s.loop.push(""))}>
        + Add a beat
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ concept images

function ConceptBoard({ scene }: { scene: Scene }) {
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const addFiles = async (files: File[]) => {
    setBusy(true);
    const count = await act(() => addConceptFiles(scene.id, files));
    setBusy(false);
    if (count === 0) toast("Only pictures (PNG, JPG, WebP) can be added.", "error");
  };
  const viewed = viewing ? assetById(viewing) : undefined;
  return (
    <section
      class={`panel concept-board${over ? " drop-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length) void addFiles(files);
      }}
    >
      <div class="panel-head">
        <h2>Concept images</h2>
        <span class="row-actions">
          <button class="button small" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : "Upload…"}
          </button>
          <button class="button small" onClick={() => setPicking(true)}>
            From library…
          </button>
        </span>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) void addFiles(files);
        }}
      />
      {scene.concepts.length === 0 ? (
        <div class="concept-empty">
          <b>Drop pictures here</b>
          <span class="muted small">
            Mood boards, sketches, screenshots of games you like, or a concept of a character. The asset suggestions
            look at the first four.
          </span>
        </div>
      ) : (
        <div class="concept-grid">
          {scene.concepts.map((concept, index) => (
            <figure key={concept.asset} class="concept">
              <button class="concept-image" title="View larger" onClick={() => setViewing(concept.asset)}>
                <Thumb asset={assetById(concept.asset)} />
                <span class="concept-index">{index + 1}</span>
              </button>
              <figcaption>
                <SavedText
                  label={`Note for picture ${index + 1}`}
                  value={concept.note}
                  placeholder="What it shows…"
                  onSave={(text) =>
                    updateScene(scene.id, (s) => {
                      const item = s.concepts.find((c) => c.asset === concept.asset);
                      if (item) item.note = text;
                    })
                  }
                />
                <button
                  class="icon-button"
                  title="Remove from the plan (stays in the library)"
                  onClick={() =>
                    void act(() =>
                      updateScene(scene.id, (s) => {
                        s.concepts = s.concepts.filter((c) => c.asset !== concept.asset);
                        for (const row of s.assets) if (row.concept === concept.asset) row.concept = null;
                      }),
                    )
                  }
                >
                  ✕
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {picking && (
        <Picker
          kind="image"
          title="Add a concept image"
          onClose={() => setPicking(false)}
          onPick={(asset) =>
            void act(() =>
              updateScene(scene.id, (s) => {
                if (!s.concepts.some((c) => c.asset === asset.id)) s.concepts.push({ asset: asset.id, note: "" });
              }),
            )
          }
          onUpload={(file) => addConceptFiles(scene.id, [file])}
        />
      )}
      {viewing && (
        <Modal title={scene.concepts.find((c) => c.asset === viewing)?.note || viewed?.title || "Concept"} onClose={() => setViewing(null)} wide>
          {viewed ? <img class="concept-large" src={viewed.file_url} alt="" /> : <p class="muted">Loading…</p>}
        </Modal>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the asset plan

/** The local model answers in about 10 s (Qwen3.5 4B on the 4090, measured 2026-11-15, with and without a picture). */
const SUGGEST_TYPICAL = 20;

function useSuggestProgress(since: string | null): Progress {
  const elapsed = useElapsed(since ?? undefined, !!since);
  const raw = elapsed / SUGGEST_TYPICAL;
  const over = raw > 1;
  const fraction = over ? Math.min(0.99, 0.95 + 0.04 * (1 - Math.exp(-(raw - 1) * 2))) : Math.min(0.95, raw * 0.95);
  return { phase: "running", fraction, elapsed, over, estimate: SUGGEST_TYPICAL };
}

function AssetPlan({ scene }: { scene: Scene }) {
  const [since, setSince] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ assets: Suggestion[]; images: number; seconds: number } | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const progress = useSuggestProgress(since);
  const open = scene.assets.filter((row) => !row.game_asset || (docsLoaded.value && !docs.value.has(row.game_asset)));
  const suggest = async () => {
    setSince(new Date().toISOString());
    const result = await act(() => suggestAssets(scene.id));
    setSince(null);
    if (result) setSuggested({ assets: result.assets, images: result.images_seen, seconds: result.seconds });
  };
  const make = async (row: PlannedAsset) => {
    setMaking(row.key);
    const doc = await act(() => makeGameAsset(scene, row));
    setMaking(null);
    return doc;
  };
  const makeAll = async () => {
    let made = 0;
    for (const row of open) if (row.name.trim() && (await make(row))) made++;
    if (made) toast(`Made ${plural(made, "game asset")}. Open each to run its steps.`, "good");
  };
  return (
    <section class="panel asset-plan">
      <div class="panel-head">
        <div>
          <h2>Assets the scene needs</h2>
          <p class="muted small">
            One row per model. The ground, road, sky, lights and UI are built in Godot, so leave them out.
            "Make game asset" starts it on the Assets page with this row's description and concept picture.
          </p>
        </div>
        <span class="row-actions">
          <button
            class="button"
            disabled={!!since || !scene.description.trim()}
            title={scene.description.trim() ? "The local model reads the plan and the first four pictures" : "Describe the scene first"}
            onClick={() => void suggest()}
          >
            {since ? "Suggesting…" : "Suggest assets"}
          </button>
          <button
            class="button"
            onClick={() =>
              void act(() =>
                updateScene(scene.id, (s) =>
                  void s.assets.push({
                    key: newKey(),
                    name: "",
                    kind: "prop",
                    idea: "",
                    role: "",
                    count: 1,
                    size: [0, 0, 0],
                    concept: null,
                    mode: "redraw",
                    game_asset: null,
                  }),
                ),
              )
            }
          >
            + Add asset
          </button>
          {open.length > 1 && (
            <button class="button primary" disabled={!!making} onClick={() => void makeAll()}>
              Make all {open.length}
            </button>
          )}
        </span>
      </div>
      {since && (
        <div class="suggest-progress">
          <ProgressBar progress={progress} />
          <span class="muted small">
            Reading the plan and pictures with the local model… {Math.round(progress.elapsed)} s
            {progress.over ? " (taking longer than usual)" : ""}
          </span>
        </div>
      )}
      {scene.assets.length === 0 ? (
        <p class="muted">
          No assets yet. Add them by hand, or describe the scene and press <b>Suggest assets</b>.
        </p>
      ) : (
        <div class="plan-rows">
          {scene.assets.map((row) => (
            <PlanRow key={row.key} scene={scene} row={row} busy={making === row.key} onMake={() => void make(row)} />
          ))}
        </div>
      )}
      {suggested && <Suggestions scene={scene} result={suggested} onClose={() => setSuggested(null)} />}
    </section>
  );
}

function PlanRow({ scene, row, busy, onMake }: { scene: Scene; row: PlannedAsset; busy: boolean; onMake: () => void }) {
  const edit = (change: (target: PlannedAsset) => void) =>
    act(() =>
      updateScene(scene.id, (s) => {
        const target = s.assets.find((item) => item.key === row.key);
        if (target) change(target);
      }),
    );
  const doc = row.game_asset ? docs.value.get(row.game_asset) : undefined;
  const gone = !!row.game_asset && docsLoaded.value && !doc;
  const concept = row.concept ? assetById(row.concept) : undefined;
  return (
    <article class={`plan-row${doc ? " made" : ""}`}>
      <div class="plan-concept">
        <span class="thumb">{concept ? <Thumb asset={concept} /> : <span class="thumb-icon">—</span>}</span>
        <select
          aria-label="Concept picture"
          value={row.concept ?? ""}
          disabled={!!doc}
          onChange={(event) => void edit((t) => void (t.concept = event.currentTarget.value || null))}
        >
          <option value="">No picture</option>
          {scene.concepts.map((c, index) => (
            <option key={c.asset} value={c.asset}>
              Picture {index + 1}
              {c.note ? `: ${c.note.slice(0, 24)}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div class="plan-fields">
        <div class="plan-line">
          <SavedText class="plan-name" label="Asset name" value={row.name} placeholder="Name" onSave={(text) => edit((t) => void (t.name = text))} />
          <select
            aria-label="Kind"
            value={row.kind}
            disabled={!!doc}
            onChange={(event) => void edit((t) => void (t.kind = event.currentTarget.value as Kind))}
          >
            {KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.label}
              </option>
            ))}
          </select>
          <label class="plan-count" title="How many the scene places">
            ×
            <input
              type="number"
              min={1}
              max={99}
              value={row.count}
              onChange={(event) => void edit((t) => void (t.count = Math.max(1, Math.min(99, Number(event.currentTarget.value) || 1))))}
            />
          </label>
        </div>
        <span class="plan-size" title="Real size in metres; the model is scaled to it when sent to Godot">
          Size (m)
          {(["W", "H", "D"] as const).map((axis, i) => (
            <SavedText
              key={axis}
              label={`${axis} in metres`}
              placeholder={axis}
              value={(row.size[i] ?? 0) > 0 ? String(row.size[i]) : ""}
              onSave={(text) =>
                edit((t) => {
                  const value = Number(text.replace(",", "."));
                  const next = [...t.size] as [number, number, number];
                  next[i] = Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0;
                  t.size = next;
                })
              }
            />
          ))}
        </span>
        <SavedText
          label="Role in the gameplay"
          value={row.role}
          placeholder="What it does: player, collectable, the goal, scenery…"
          onSave={(text) => edit((t) => void (t.role = text))}
        />
        <SavedText
          rows={2}
          label="What it looks like"
          value={row.idea}
          placeholder="What it looks like: shape, materials, colours, style"
          onSave={(text) => edit((t) => void (t.idea = text))}
        />
      </div>
      <div class="plan-status">
        {doc ? (
          <a class="plan-made" href={`#/a/${doc.id}`}>
            <span class="thumb">
              <AssetCover doc={doc} />
            </span>
            <span>
              <b>Open game asset</b>
              <span class="small muted">{assetProgress(doc).line}</span>
              <MiniSteps doc={doc} />
            </span>
          </a>
        ) : (
          <>
            {gone && <span class="small muted">Its game asset was deleted.</span>}
            {row.concept && (
              <select
                aria-label="How to use the picture"
                value={row.mode}
                onChange={(event) => void edit((t) => void (t.mode = event.currentTarget.value as ReferenceMode))}
              >
                <option value="redraw">Draw it from the picture</option>
                <option value="pose">Keep it, pose for 3D</option>
                <option value="as-is">Use the picture as it is</option>
              </select>
            )}
            <button class="button primary small" disabled={busy || !row.name.trim()} onClick={onMake}>
              {busy ? "Making…" : gone ? "Make again" : "Make game asset"}
            </button>
          </>
        )}
        <ConfirmButton
          class="ghost small"
          label="Remove"
          confirm="Remove row?"
          onConfirm={() => void act(() => updateScene(scene.id, (s) => void (s.assets = s.assets.filter((item) => item.key !== row.key))))}
        />
      </div>
    </article>
  );
}

function Suggestions({
  scene,
  result,
  onClose,
}: {
  scene: Scene;
  result: { assets: Suggestion[]; images: number; seconds: number };
  onClose: () => void;
}) {
  const have = new Set(scene.assets.map((row) => row.name.trim().toLowerCase()));
  const [chosen, setChosen] = useState<Set<number>>(
    () => new Set(result.assets.map((item, index) => (have.has(item.name.toLowerCase()) ? -1 : index)).filter((i) => i >= 0)),
  );
  const toggle = (index: number) => {
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setChosen(next);
  };
  const add = () =>
    void act(async () => {
      await updateScene(scene.id, (s) => {
        for (const index of [...chosen].sort((a, b) => a - b)) {
          const item = result.assets[index];
          if (!item) continue;
          s.assets.push({ key: newKey(), ...item, size: [0, 0, 0], mode: "redraw", game_asset: null });
        }
      });
      onClose();
    });
  return (
    <Modal title="Suggested assets" onClose={onClose} wide>
      <p class="muted small">
        From the description, the loop
        {result.images ? ` and ${plural(result.images, "picture")}` : " (no pictures: add some for a closer match)"}, in{" "}
        {Math.round(result.seconds)} s. Tick the ones to add; you can edit them afterwards.
      </p>
      <div class="suggest-list">
        {result.assets.map((item, index) => {
          const dupe = have.has(item.name.toLowerCase());
          return (
            <label key={index} class={`suggest-item${chosen.has(index) ? " on" : ""}`}>
              <input type="checkbox" checked={chosen.has(index)} onChange={() => toggle(index)} />
              <span class="thumb">{item.concept ? <Thumb asset={assetById(item.concept)} /> : <span class="thumb-icon">—</span>}</span>
              <span class="suggest-text">
                <b>
                  {item.name}
                  {item.count > 1 && <span class="muted"> ×{item.count}</span>}
                </b>
                <span class="chip">{KINDS.find((k) => k.id === item.kind)?.label ?? item.kind}</span>
                {dupe && <span class="chip">already in the plan</span>}
                <span class="small">{item.role}</span>
                <span class="small muted">{item.idea}</span>
              </span>
            </label>
          );
        })}
      </div>
      <footer class="modal-actions">
        <button class="button ghost" onClick={onClose}>
          Cancel
        </button>
        <button class="button primary" disabled={chosen.size === 0} onClick={add}>
          Add {plural(chosen.size, "asset")} to the plan
        </button>
      </footer>
    </Modal>
  );
}
