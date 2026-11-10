// All game assets as cards, and the dialog to start a new one.
import { useEffect, useState } from "preact/hooks";

import type { GameAsset, Kind } from "./api";
import { Thumb } from "./Preview";
import { act, allJobIds, createDoc, docs, docsLoaded, ensureJobs, worldOf } from "./state";
import { coverImage, finalResult, included, KINDS, status, STEPS } from "./steps";
import { Modal, STATUS_TEXT } from "./ui";

export function Home() {
  const [creating, setCreating] = useState(false);
  const list = [...docs.value.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  useEffect(() => ensureJobs(list.flatMap(allJobIds)), [list.length]);
  return (
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Game assets</h1>
          <p class="muted">Each asset goes from an idea to a game-ready model in Godot, one step at a time.</p>
        </div>
        <button class="button primary" onClick={() => setCreating(true)}>
          + New asset
        </button>
      </header>
      {!docsLoaded.value ? (
        <div class="center"><span class="spinner" /></div>
      ) : list.length === 0 ? (
        <div class="empty">
          <h2>Make your first game asset</h2>
          <p>
            Type a short idea such as <i>rusty wheelbarrow</i>. The studio writes a description, makes a concept
            image, turns it into a textured 3D model and sends it to Godot. You can check and redo every step.
          </p>
          <button class="button primary" onClick={() => setCreating(true)}>
            + New asset
          </button>
        </div>
      ) : (
        <div class="cards">
          {list.map((doc) => (
            <Card key={doc.id} doc={doc} />
          ))}
        </div>
      )}
      {creating && <NewAsset onClose={() => setCreating(false)} />}
    </div>
  );
}

function Card({ doc }: { doc: GameAsset }) {
  const world = worldOf(doc);
  const steps = STEPS.filter((step) => included(doc, step));
  const states = steps.map((step) => ({ step, state: status(world, step) }));
  const running = states.find((item) => item.state === "running");
  const failed = states.find((item) => item.state === "failed");
  const next = states.find((item) => item.state !== "done");
  const sent = (doc.godot.exports ?? []).at(-1);
  const final = finalResult(world);
  const line = running
    ? `${running.step.title}: working…`
    : failed
      ? `${failed.step.title} failed`
      : sent && !next
        ? `In Godot: ${sent.project_name}`
        : !next
          ? "Ready to send to Godot"
          : next.state === "stale"
            ? `${next.step.title}: needs update`
            : `Next: ${next.step.title}`;
  const cover = coverImage(world);
  return (
    <a class="card" href={`#/a/${doc.id}`}>
      <span class="card-image">
        {final && final.result.asset.mime === "model/gltf-binary" ? <Thumb asset={final.result.asset} /> : cover ? <Thumb asset={cover} /> : <span class="card-placeholder">{doc.name.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span class="card-body">
        <b>{doc.name}</b>
        <span class={`card-line${running ? " live" : failed ? " bad" : ""}`}>{line}</span>
        <span class="mini-steps" aria-label="Step progress">
          {states.map(({ step, state }) => (
            <span key={step.id} class={`mini s-${state}`} title={`${step.title}: ${STATUS_TEXT[state]}`} />
          ))}
          <span class={`mini s-${sent ? "done" : "ready"}`} title="Godot" />
        </span>
      </span>
    </a>
  );
}

function NewAsset({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("prop");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const doc = await act(() => createDoc(name.trim(), kind, idea.trim() || name.trim()));
    setBusy(false);
    if (doc) {
      onClose();
      window.location.hash = `#/a/${doc.id}`;
    }
  };
  return (
    <Modal title="New game asset" onClose={onClose}>
      <label class="field">
        <span>Name</span>
        <input
          value={name}
          placeholder="e.g. Rusty wheelbarrow"
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && name.trim() && void create()}
        />
      </label>
      <fieldset class="kinds">
        <legend>What is it?</legend>
        {KINDS.map((item) => (
          <label key={item.id} class={`kind${kind === item.id ? " on" : ""}`}>
            <input type="radio" name="kind" checked={kind === item.id} onChange={() => setKind(item.id)} />
            <b>{item.label}</b>
            <span class="muted small">{item.hint}</span>
          </label>
        ))}
      </fieldset>
      <p class="muted small">
        Characters and creatures also get a skeleton so they can be animated. You can change any step later.
      </p>
      <label class="field">
        <span>Idea (optional)</span>
        <textarea
          rows={2}
          value={idea}
          placeholder="A few words. Leave empty to use the name."
          onInput={(event) => setIdea(event.currentTarget.value)}
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
