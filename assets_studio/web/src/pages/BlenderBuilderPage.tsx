import { useEffect, useState } from "preact/hooks";
import { blenderBuilder, type BuilderJob, type BuilderModel, type BuilderStatus } from "../api/blenderBuilder";
import type { Asset, InputSpec } from "../api/client";
import { AssetPreview } from "../components/AssetPreview";
import { InputPicker } from "../components/InputPicker";
import { hrefLibrary } from "../state/router";
import "./blender-builder.css";

type Draft = {
  prompt: string;
  model: string;
  moving: boolean;
  detail: "standard" | "detailed";
  repairs: 1 | 2 | 3;
  seed: string;
  reference: string | null;
};
const DRAFT_KEY = "studio.blender-builder.draft.v1";
const JOB_KEY = "studio.blender-builder.job.v1";
const INITIAL: Draft = { prompt: "", model: "", moving: true, detail: "detailed", repairs: 2, seed: "7137", reference: null };
const REFERENCE: InputSpec = { role: "reference", description: "Reference image", required: false,
  mime: ["image/png", "image/jpeg", "image/webp"], labels: null };

function loadDraft(): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as Partial<Draft> | null;
    if (!saved) return INITIAL;
    return {
      prompt: typeof saved.prompt === "string" ? saved.prompt : "",
      model: typeof saved.model === "string" ? saved.model : "",
      moving: typeof saved.moving === "boolean" ? saved.moving : true,
      detail: saved.detail === "standard" ? "standard" : "detailed",
      repairs: saved.repairs === 1 || saved.repairs === 3 ? saved.repairs : 2,
      seed: typeof saved.seed === "string" ? saved.seed : "7137",
      reference: typeof saved.reference === "string" ? saved.reference : null,
    };
  } catch { return INITIAL; }
}

function loadJob(): string {
  try { return localStorage.getItem(JOB_KEY) ?? ""; } catch { return ""; }
}

const busy = (job: BuilderJob) => job.status === "queued" || job.status === "running";
const statusLabel = (job: BuilderJob) => ({ queued: "Queued", running: "Working", succeeded: "Ready", failed: "Needs attention", cancelled: "Cancelled" })[job.status];
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);

function historyTitle(job: BuilderJob): string {
  const title = (job.title || (job.kind === "model-install" ? "Model download" : job.prompt) || "Asset build").replace(/\s+/g, " ").trim();
  if (title.length <= 100) return title;
  const start = title.slice(0, 100);
  const lastSpace = start.lastIndexOf(" ");
  return `${start.slice(0, lastSpace >= 80 ? lastSpace : 100)}…`;
}

function modelTitle(id: string, models: BuilderModel[]): string {
  const withoutDefaultTag = (value: string) => value.replace(/:latest$/, "");
  const model = models.find(item => withoutDefaultTag(item.id) === withoutDefaultTag(id));
  return model?.name.split(" · ")[0] ?? id;
}

function recommendedModel(models: BuilderModel[]) {
  return models.find(model => model.recommended && model.installed) ??
    models.find(model => model.id === "qwen3-coder:30b" && model.installed) ??
    models.find(model => model.installed) ?? models.find(model => model.recommended) ?? models[0];
}

function Result({ job, onOpen, onReuse, opening }: { job: BuilderJob; onOpen: () => void; onReuse: () => void; opening: boolean }) {
  const [view, setView] = useState<"render" | "model">("render");
  const [imageName, setImageName] = useState("");
  const images = job.files.filter(file => file.kind === "image");
  const image = images.find(file => file.name === imageName) ?? images[0];
  const model = job.files.find(file => file.kind === "glb");
  const shownView = view === "render" && !image && model ? "model" : view;
  const preview: Asset | null = model ? {
    id: `${job.id}-preview`, kind: "mesh", mime: "model/gltf-binary", size_bytes: 0,
    blob_sha256: "", origin: "blender-builder", created_at: job.created_at, title: job.title ?? job.prompt,
    source_url: null, favorite: false, meta: {}, deleted_at: null, rating: null, tags: [], file_url: model.url,
  } : null;
  const blends = job.files.filter(file => file.kind === "blend");
  const mainDownloads = job.files.filter(file => file.kind === "blend" || file.kind === "glb");
  const otherDownloads = job.files.filter(file => file.kind !== "blend" && file.kind !== "glb" && file.kind !== "image");
  const failed = job.status === "failed";
  const technicalDetails = job.error || (failed ? job.message : "");
  return <section class="builder-card builder-result" aria-label="Build result">
    <div class="builder-heading-row">
      <div><span class={`builder-state ${job.status}`}>{statusLabel(job)}</span>
        <h2>{job.title ?? (job.kind === "model-install" ? "Model download" : "Your build")}</h2></div>
      <div class="builder-result-actions">
        {job.prompt && job.kind !== "model-install" && <button class="button" onClick={onReuse}>Use these settings</button>}
        {blends.length > 0 && <button class="button primary" disabled={opening} onClick={onOpen}>
          {opening ? "Opening Blender…" : "Open in Blender"}
        </button>}
      </div>
    </div>
    {job.summary && !failed && <p>{job.summary}</p>}
    <div class={`builder-progress${failed ? " builder-failure" : ""}`} role={failed ? "alert" : "status"} aria-live="polite">
      {busy(job) && <span class="spinner" />}
      <div><strong>{failed ? "This build could not finish." : job.stage || statusLabel(job)}</strong>
        {failed ? <p>Your description and any saved files are kept. Adjust the description or try another installed model, then build again.</p> : job.message && <p>{job.message}</p>}</div>
    </div>
    {technicalDetails && <details class="builder-technical-details"><summary>Technical details</summary><pre>{technicalDetails}</pre></details>}
    {(image || model) && <>
      <div class="row builder-preview-tabs" role="group" aria-label="Preview view">
        {image && <button class="button small" aria-pressed={shownView === "render"} onClick={() => setView("render")}>Render</button>}
        {model && <button class="button small" aria-pressed={shownView === "model"} onClick={() => setView("model")}>3D model</button>}
      </div>
      {shownView === "model" && preview ? <div class="builder-model"><AssetPreview asset={preview} /></div> : image &&
        <a class="builder-render" href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={image.label || "Rendered preview of the built asset"} /></a>}
      {shownView === "render" && images.length > 1 && <div class="builder-render-choices" role="group" aria-label="Rendered views">
        {images.map(file => <button key={file.name} class="button small" aria-pressed={file.name === image?.name} onClick={() => setImageName(file.name)}>{file.label}</button>)}
      </div>}
    </>}
    {(mainDownloads.length > 0 || job.library_asset) && <div class="builder-downloads" aria-label="Asset files">
      {job.library_asset && <a class="button" href={hrefLibrary(job.library_asset)}>Open in Library</a>}
      {mainDownloads.map(file => <a class="button" key={file.name} href={file.url} download={file.name}>{file.label}</a>)}
    </div>}
    {job.library_warning && <p class="hint" role="status">{job.library_warning}</p>}
    {job.controls && job.controls.length > 0 && <details><summary>Movable controls</summary><p class="hint">The Blender project keeps these controls editable. See the included instructions for how to pose it.</p><div class="builder-controls">{job.controls.map((control, index) => typeof control === "string" ?
      <span key={index}>{control.replaceAll("_", " ")}</span> : <div class="builder-control-group" key={index}>
        <strong>{control.object.replaceAll("_", " ")}</strong><div class="builder-controls">{Object.entries(control.properties).map(([property, value]) => <span key={property}>{property.replaceAll("_", " ")}: {String(value)}</span>)}</div>
      </div>)}</div></details>}
    {otherDownloads.length > 0 && <details><summary>Source and build details</summary><div class="builder-downloads">{otherDownloads.map(file => <a key={file.name} href={file.url} download={file.name}>{file.label}</a>)}</div></details>}
    {job.prompt && job.kind !== "model-install" && <details class="builder-description"><summary>Original description</summary><p>{job.prompt}</p></details>}
  </section>;
}

export function BlenderBuilderPage() {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [status, setStatus] = useState<BuilderStatus | null>(null);
  const [jobs, setJobs] = useState<BuilderJob[]>([]);
  const [selectedId, setSelectedId] = useState(loadJob);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const [nextStatus, result] = await Promise.all([blenderBuilder.status(), blenderBuilder.jobs()]);
        if (mounted) { setStatus(nextStatus); setJobs(result.jobs); setLoadError(""); }
      } catch (error) { if (mounted) setLoadError(failureText(error)); }
      if (mounted) timer = setTimeout(() => { void refresh(); }, 1500);
    };
    void refresh();
    return () => { mounted = false; if (timer) clearTimeout(timer); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* Storage can be unavailable. */ }
  }, [draft]);
  useEffect(() => {
    if (status?.models.length && !status.models.some(model => model.id === draft.model)) {
      const chosen = recommendedModel(status.models);
      if (chosen) setDraft(current => ({ ...current, model: chosen.id }));
    }
  }, [status, draft.model]);
  useEffect(() => {
    if (jobs[0] && !jobs.some(job => job.id === selectedId)) setSelectedId(jobs[0].id);
    try { localStorage.setItem(JOB_KEY, selectedId); } catch { /* Storage can be unavailable. */ }
  }, [selectedId, jobs]);

  const model = status?.models.find(item => item.id === draft.model);
  const selected = jobs.find(job => job.id === selectedId);
  const active = jobs.find(busy);
  const seedNumber = draft.seed.trim() ? Number(draft.seed) : undefined;
  const seedValid = seedNumber === undefined || (Number.isInteger(seedNumber) && seedNumber >= 0 && seedNumber < 2 ** 32);
  const referenceBlocked = Boolean(draft.reference && model && !model.vision);
  const blocked = sending || !draft.prompt.trim() || !model?.installed || !status?.available || !seedValid || referenceBlocked;
  function saveJob(job: BuilderJob) {
    setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
    setSelectedId(job.id);
  }
  function reuse(job: BuilderJob) {
    setDraft({ prompt: job.prompt, model: job.model,
      moving: job.moving_parts ?? INITIAL.moving, detail: job.detail ?? INITIAL.detail,
      repairs: job.repair_rounds ?? INITIAL.repairs,
      seed: job.seed === undefined ? INITIAL.seed : String(job.seed),
      reference: job.reference_asset ?? null,
    });
    setActionError("");
    setNotice("Description and settings loaded. Reselect the reference image if needed.");
  }
  async function create() {
    if (blocked) return;
    setSending(true); setActionError(""); setNotice("");
    try {
      saveJob(await blenderBuilder.create({ prompt: draft.prompt.trim(), model: draft.model,
        moving_parts: draft.moving, detail: draft.detail, repair_rounds: draft.repairs,
        ...(seedNumber === undefined ? {} : { seed: seedNumber }),
        ...(draft.reference ? { reference: draft.reference } : {}),
      }));
    } catch (error) { setActionError(failureText(error)); }
    finally { setSending(false); }
  }
  async function install() {
    if (!model || sending) return;
    setSending(true); setActionError(""); setNotice("");
    try { saveJob(await blenderBuilder.install(model.id)); }
    catch (error) { setActionError(failureText(error)); }
    finally { setSending(false); }
  }
  async function cancel(job: BuilderJob) {
    setActionError("");
    try { saveJob(await blenderBuilder.cancel(job.id)); }
    catch (error) { setActionError(failureText(error)); }
  }
  async function open(job: BuilderJob) {
    setOpening(true); setActionError(""); setNotice("");
    try { await blenderBuilder.open(job.id); setNotice("The project is opening in Blender."); }
    catch (error) { setActionError(failureText(error)); }
    finally { setOpening(false); }
  }

  return <div class="blender-builder">
    <header class="builder-page-head"><div><span class="builder-local">Runs locally</span><h1>Build in Blender</h1>
      <p>Describe one object. Your local model writes Blender code; Studio builds, checks and repairs it.</p></div>
      <span class="builder-format-note">Editable Blender project + GLB + preview</span></header>
    <div class="builder-columns">
      <div class="builder-left">
        <section class="builder-card" aria-label="Describe your asset">
          <label class="field"><span>What would you like to build?</span><textarea rows={6} value={draft.prompt}
            placeholder="Describe the object, its style, materials, and any parts that should move."
            onInput={event => setDraft(current => ({ ...current, prompt: event.currentTarget.value }))} /></label>
          <label class="field"><span>Local model</span><select value={draft.model}
            onChange={event => setDraft(current => ({ ...current, model: event.currentTarget.value }))}>
            {!status?.models.length && <option value="">Checking local models…</option>}
            {status?.models.map(item => <option key={item.id} value={item.id}>{item.name}{item.recommended && !item.name.toLowerCase().includes("recommended") ? " · recommended candidate" : ""}{item.installed ? "" : " · download needed"}</option>)}
          </select></label>
          {model && <div class="builder-model-note"><p>{model.description}</p>
            <span class="hint">{model.vision ? "Can use a reference image and inspect renders." : "Text input; execution feedback is used for repairs."}</span>
            {model.source && <a href={model.source} target="_blank" rel="noreferrer">Model details ↗</a>}
            {!model.installed && model.downloadable && <button class="button" disabled={sending || !status?.ollama || Boolean(active)} onClick={() => void install()}>
              Download model{model.size_gb ? ` · about ${model.size_gb} GB` : ""}
            </button>}
          </div>}
          <label class="check"><input type="checkbox" checked={draft.moving} onChange={event => setDraft(current => ({ ...current, moving: event.currentTarget.checked }))} />Include movable parts and a demonstration animation</label>
          <details class="builder-reference"><summary>Optional reference image{draft.reference ? " · selected" : ""}</summary>
            <InputPicker spec={REFERENCE} assetId={draft.reference} onChange={reference => setDraft(current => ({ ...current, reference }))} />
            {referenceBlocked && <p class="builder-error">Choose a model with image input, or remove the reference image.</p>}
          </details>
          <details><summary>Build options</summary><div class="builder-options">
            <label class="field"><span>Detail</span><select value={draft.detail} onChange={event => {
              const detail = event.currentTarget.value;
              if (detail === "standard" || detail === "detailed") setDraft(current => ({ ...current, detail }));
            }}><option value="standard">Standard · quicker first build</option><option value="detailed">Detailed · more construction detail</option></select></label>
            <label class="field"><span>Repair attempts</span><select value={draft.repairs} onChange={event => {
              const repairs = Number(event.currentTarget.value);
              if (repairs === 1 || repairs === 2 || repairs === 3) setDraft(current => ({ ...current, repairs }));
            }}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select><span class="hint">The model can revise code after a failed build or review.</span></label>
            <label class="field"><span>Seed</span><input type="text" inputMode="numeric" value={draft.seed} aria-invalid={!seedValid}
              onInput={event => setDraft(current => ({ ...current, seed: event.currentTarget.value }))} /><span class="hint">Keep the same seed when comparing models. Leave blank for a new seed.</span></label>
            {!seedValid && <p class="builder-error">Enter a whole-number seed between 0 and 4,294,967,295.</p>}
          </div></details>
          {loadError && <p class="builder-error" role="alert">{loadError}</p>}
          {status?.message && <p class="hint">{status.message}</p>}
          {status && (!status.blender || !status.ollama) && <p class="builder-error">{!status.blender ? "Blender is unavailable. " : ""}{!status.ollama ? "Start the local model engine to build or download models." : ""}</p>}
          <button class="button primary builder-build" disabled={blocked} onClick={() => void create()}>{sending ? "Starting…" : active ? "Queue asset build" : "Build asset"}</button>
          <p class="hint builder-expectation">This is an experimental coding workflow. Review the renders and moving parts before using the result.</p>
        </section>
        <section class="builder-card builder-history" aria-label="Build history"><h2>Recent builds</h2>
          {!jobs.length && <p class="hint">Your builds and model downloads will appear here. You can leave this page while a job runs.</p>}
          {jobs.map(job => <div key={job.id} class={`builder-history-item${selectedId === job.id ? " selected" : ""}`}>
            <button class="builder-history-select" onClick={() => setSelectedId(job.id)} aria-pressed={selectedId === job.id}>
              <strong>{historyTitle(job)}</strong>
              <span>{statusLabel(job)} · {new Date(job.created_at).toLocaleString()} · {modelTitle(job.model, status?.models ?? [])}</span>
            </button>
            {busy(job) && <button class="button small" onClick={() => void cancel(job)}>Cancel</button>}
          </div>)}
        </section>
      </div>
      <div class="builder-right">
        {actionError && <p class="builder-error builder-card" role="alert">{actionError}</p>}
        {notice && <p class="builder-card builder-notice" role="status">{notice}</p>}
        {selected ? <Result key={selected.id} job={selected} opening={opening} onOpen={() => void open(selected)} onReuse={() => reuse(selected)} /> :
          <section class="builder-card builder-empty" aria-label="Build preview"><span class="builder-empty-icon" aria-hidden="true">◇</span><h2>Your asset starts here</h2><p>The finished build will include a rendered preview, an editable Blender project, and a GLB.</p><p class="hint">Ask for the moving parts you need. The model chooses construction for that object.</p></section>}
      </div>
    </div>
  </div>;
}
