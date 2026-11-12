// The last step: copy the finished model into a Godot project of your choice.
import { useEffect, useState } from "preact/hooks";

import { Conflict, pipelineApi, type GameAsset, type GodotProject } from "./api";
import { Thumb } from "./Preview";
import { act, toast, update, worldOf } from "./state";
import { picked, sendable, STEPS } from "./steps";
import { Modal } from "./ui";

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "asset";

let projectCache: GodotProject[] | null = null;

export function GodotCard({ doc, number }: { doc: GameAsset; number: number }) {
  const world = worldOf(doc);
  const options = sendable(world);
  const [choice, setChoice] = useState<string | null>(null);
  const final = options.find((item) => item.step.id === choice) ?? options[0];
  const move = (final?.result.asset.meta as Record<string, unknown> | undefined)?.move;
  const [projects, setProjects] = useState<GodotProject[] | null>(projectCache);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState<string | null>(null);
  const project = doc.godot.project ?? projects?.[0]?.path ?? "";
  const [folder, setFolder] = useState(doc.godot.folder ?? slug(doc.name));
  const [fileName, setFileName] = useState(doc.godot.file_name ?? slug(doc.name));
  // each motion gets its own file by default: sending a walk must not replace a sneak
  useEffect(() => {
    if (typeof move === "string") setFileName(`${slug(doc.name)}-${slug(move).slice(0, 30)}`);
    else setFileName(doc.godot.file_name ?? slug(doc.name));
  }, [final?.result.asset.id]);
  const exports = [...(doc.godot.exports ?? [])].reverse();

  const refresh = () =>
    void act(pipelineApi.godotProjects).then((list) => {
      if (!list) return;
      projectCache = list;
      setProjects(list);
    });
  useEffect(refresh, []);

  async function send(overwrite: boolean) {
    if (!final || !project) return;
    setBusy(true);
    setReplace(null);
    try {
      const provenance = Object.fromEntries(
        STEPS.flatMap((step) => {
          const result = picked(world, step);
          return result ? [[step.id, result.asset.id]] : [];
        }),
      );
      const record = await pipelineApi.exportToGodot({
        asset_id: final.result.asset.id,
        project,
        folder,
        file_name: fileName,
        overwrite,
        pipeline_asset: doc.id,
        provenance,
      });
      await update(doc.id, (next) => {
        next.godot = {
          ...next.godot,
          project,
          folder,
          file_name: fileName,
          exports: [...(next.godot.exports ?? []), { ...record, asset: final.result.asset.id }],
        };
      });
      toast(
        `Sent to ${record.project_name} as ${record.res_path}.` +
          (record.demo_scene ? ` Demo: open ${record.demo_scene} and press F6 (walks on a checker floor).` : "") +
          " Switch to Godot and it imports automatically.",
        "good",
      );
    } catch (error) {
      if (error instanceof Conflict) setReplace(error.message);
      else toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  const sentThis = exports.find((item) => item.asset === final?.result.asset.id && item.project === project);

  return (
    <section class={`step godot state-${final ? (sentThis ? "done" : "ready") : "blocked"}`} id="step-godot">
      <header class="step-head">
        <span class="step-number">{sentThis ? "✓" : number}</span>
        <div class="step-title">
          <h3>Send to Godot</h3>
          <p class="muted">Copies the finished model into your Godot project, in its own folder under res://assets/.</p>
        </div>
      </header>

      {!final ? (
        <p class="note">Finish at least the 3D shape first. The newest finished step is what gets sent.</p>
      ) : (
        <>
          <div class="godot-final">
            <span class="thumb">
              <Thumb asset={final.result.asset} />
            </span>
            <div class="grow">
              {options.length > 1 ? (
                <label class="field">
                  <span>Send</span>
                  <select value={final.step.id} onChange={(event) => setChoice(event.currentTarget.value)}>
                    {options.map((item) => {
                      const m = (item.result.asset.meta as Record<string, unknown>).move;
                      return (
                        <option key={item.step.id} value={item.step.id}>
                          {item.step.title}
                          {typeof m === "string" ? ` · “${m.slice(0, 50)}”` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : (
                <b>Sends the result of “{final.step.title}”</b>
              )}
              <p class="muted small">
                {final.result.asset.mime === "model/x-fbx" ? "FBX file" : "GLB file with textures"} ·{" "}
                {(final.result.asset.size_bytes / 1e6).toFixed(1)} MB
              </p>
            </div>
          </div>
          <div class="godot-form">
            <label class="field grow">
              <span>Godot project</span>
              <span class="row">
                <select
                  value={project}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    void act(() => update(doc.id, (next) => void (next.godot = { ...next.godot, project: value })));
                  }}
                >
                  {projects === null && <option>Looking for projects…</option>}
                  {projects?.length === 0 && <option value="">No Godot projects found</option>}
                  {projects?.map((item) => (
                    <option key={item.path} value={item.path}>
                      {item.name} — {item.path}
                    </option>
                  ))}
                </select>
                <button class="button small ghost" onClick={() => setAdding(true)}>
                  Add project…
                </button>
              </span>
            </label>
            <label class="field">
              <span>Folder</span>
              <input value={folder} onInput={(event) => setFolder(event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>File name</span>
              <input value={fileName} onInput={(event) => setFileName(event.currentTarget.value)} />
            </label>
          </div>
          <p class="muted small">
            Will be saved as <code>res://assets/{slug(folder)}/{slug(fileName)}.{final.result.asset.mime === "model/x-fbx" ? "fbx" : "glb"}</code>
          </p>
          {replace ? (
            <div class="note warn">
              {replace}
              <div class="note-actions">
                <button class="button small danger" disabled={busy} onClick={() => void send(true)}>
                  Replace it
                </button>
                <button class="button small ghost" onClick={() => setReplace(null)}>
                  Keep the old one
                </button>
              </div>
            </div>
          ) : (
            <footer class="step-actions">
              <button class="button primary" disabled={busy || !project} onClick={() => void send(false)}>
                {busy ? "Sending…" : sentThis ? "Send again" : "Send to Godot"}
              </button>
            </footer>
          )}
        </>
      )}

      {exports.length > 0 && (
        <ul class="exports">
          {exports.slice(0, 5).map((item) => (
            <li key={item.exported_at + item.path}>
              <span>
                <b>{item.project_name}</b> <code>{item.res_path}</code>
                <span class="muted small"> · {new Date(item.exported_at).toLocaleString()}</span>
              </span>
              <button class="button small ghost" onClick={() => void act(() => pipelineApi.reveal(item.path))}>
                Show in Explorer
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddProject
          onClose={() => setAdding(false)}
          onAdded={(added) => {
            refresh();
            void act(() => update(doc.id, (next) => void (next.godot = { ...next.godot, project: added.path })));
          }}
        />
      )}
    </section>
  );
}

function AddProject({ onClose, onAdded }: { onClose: () => void; onAdded: (project: GodotProject) => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Add a Godot project" onClose={onClose}>
      <p class="muted">
        Paste the folder that contains <code>project.godot</code>. Projects in Documents, Desktop and
        C:\GodotPlatformer are found automatically.
      </p>
      <label class="field">
        <span>Project folder</span>
        <input
          value={path}
          placeholder="C:\Users\you\Documents\my-game"
          onInput={(event) => setPath(event.currentTarget.value)}
        />
      </label>
      {error && <p class="note error">{error}</p>}
      <footer class="modal-actions">
        <button class="button ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          class="button primary"
          disabled={!path.trim()}
          onClick={() =>
            void pipelineApi.addGodotProject(path.trim()).then(
              (added) => {
                onAdded(added);
                onClose();
              },
              (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
            )
          }
        >
          Add project
        </button>
      </footer>
    </Modal>
  );
}
