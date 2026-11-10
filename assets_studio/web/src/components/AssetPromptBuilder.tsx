import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api/client";
import { draftFor, targetOf, updateDraft } from "../state/drafts";
import type { Section } from "../state/sections";
import { mergeJob, putAsset, servers } from "../state/store";

export function AssetPromptBuilder({ section, onBusy }: {
  section: Section;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [checks, setChecks] = useState<string[]>([]);
  const [purpose, setPurpose] = useState('Object reference');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; onBusy(false); }, []);
  const writer = servers.value.find((server) => server.id === "asset-prompt-agent");
  const subject = draftFor(section).prompt.trim();

  async function build() {
    if (!subject || !writer || busy) return;
    const source = draftFor(section).prompt;
    setBusy(true); onBusy(true); setError(""); setMessage(""); setChecks([]);
    try {
      let job = await api.createJob({ server: writer.id, task: "asset-prompt",
        prompt: subject, count: 1, params: { purpose }, inputs: {}, dependencies: {} });
      mergeJob(job);
      const deadline = Date.now() + 240000;
      while (job.status === "queued" || job.status === "running") {
        if (Date.now() > deadline) throw new Error("Prompt writing is taking longer than expected. Check Jobs for the saved result.");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        job = await api.job(job.id); mergeJob(job);
      }
      if (job.status !== "succeeded") throw new Error(job.error_message || "Prompt writing did not finish.");
      const id = job.outputs[0];
      if (!id) throw new Error("The writer returned no prompt.");
      const asset = await api.asset(id); putAsset(asset);
      const response = await fetch(asset.file_url);
      if (!response.ok) throw new Error("Could not read the saved prompt.");
      const expanded = await response.text();
      if (!mounted.current) return;
      const current = draftFor(section);
      if (current.prompt !== source || targetOf(section, current)?.server.id !== "qwen-image") {
        setMessage("Your description changed while writing. The expanded prompt is saved in Library as a text asset.");
        return;
      }
      updateDraft(section, { prompt: expanded,
        params: { ...current.params, asset_reference: false } });
      const checklist = asset.meta.checks;
      setChecks(Array.isArray(checklist) ? checklist.filter((item): item is string => typeof item === "string") : []);
      setMessage("Expanded locally. Review or edit the description, then click Generate. Camera and styling are included in the prompt.");
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) { setBusy(false); onBusy(false); }
    }
  }

  return <div class="field">
    <label class="field"><span>Prepare for</span><select value={purpose} disabled={busy}
      onChange={(event) => setPurpose(event.currentTarget.value)}>
      {['Object reference', 'Humanoid for rigging', 'Creature for rigging', 'Mechanical prop'].map((value) =>
        <option key={value} value={value}>{value}</option>)}
    </select></label>
    <button class="button" disabled={busy || !subject || !writer} onClick={() => void build()}>
      {busy ? "Writing asset prompt…" : "Build asset prompt"}
    </button>
    <span class="hint">Enter an object name or short idea. The local writer adds details, materials and a view suited to that object.</span>
    {message && <p class="hint" role="status">{message}</p>}
    {checks.length > 0 && <details><summary>Check the generated image for…</summary>
      <ul>{checks.map((check) => <li key={check}>{check}</li>)}</ul></details>}
    {error && <p class="hint error" role="alert">{error}</p>}
  </div>;
}
