import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { api, type Asset } from "../api/client";
import { assetName } from "../format";
import { t } from "../i18n";
import { hrefJobs, hrefLibrary } from "../state/router";
import {
  assetById,
  attempt,
  isPending,
  jobs,
  mergeJob,
  putAsset,
  servers,
} from "../state/store";
import { AssetPreview } from "./AssetPreview";

/** Cleanup is a copy-producing job; the original is always available beside it. */
function CleanupDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [removeDebris, setRemoveDebris] = useState(true);
  const [mode, setMode] = useState<"small" | "main">("small");
  const [threshold, setThreshold] = useState(0.5);
  const [removeGround, setRemoveGround] = useState(false);
  const [height, setHeight] = useState(3);
  const [cap, setCap] = useState(true);
  const [sending, setSending] = useState(false);
  const [jobId, setJobId] = useState<string | null>(
    () => [...jobs.value.values()].find((job) => job.task === "3d-cleanup" &&
      job.inputs.mesh === asset.id && isPending(job))?.id ?? null,
  );
  const renamed = useRef(new Set<string>());
  const job = jobId ? jobs.value.get(jobId) : undefined;
  const pending = sending || (!!job && isPending(job));
  const resultId = job?.status === "succeeded" ? job.outputs[0] : undefined;
  const result = resultId ? assetById(resultId) : undefined;
  const cleaners = servers.value.filter((server) =>
    server.tasks.some((task) => task.task === "3d-cleanup"),
  );
  const cleaner = cleaners.find((server) => server.state === "ready") ?? cleaners[0];
  const unavailable = !cleaner || ["error", "unavailable"].includes(cleaner.state);
  const validThreshold = !removeDebris || mode === "main" ||
    (Number.isFinite(threshold) && threshold >= 0.01 && threshold <= 10);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary',
      )].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);

  useEffect(() => {
    if (!result || renamed.current.has(result.id)) return;
    renamed.current.add(result.id);
    void attempt(() => api.updateAsset(result.id, {
      title: t("cleanup.copyName", { name: assetName(asset) }),
    })).then((updated) => updated && putAsset(updated));
  }, [result, asset]);

  async function createCopy() {
    if (!cleaner || pending || unavailable || !validThreshold) return;
    setSending(true);
    const submitted = await attempt(() => api.createJob({
      server: cleaner.id,
      task: "3d-cleanup",
      count: 1,
      inputs: { mesh: asset.id },
      params: {
        remove_debris: removeDebris,
        debris_mode: mode,
        min_component_percent: removeDebris && mode === "small" ? threshold : 0.5,
        remove_ground: removeGround,
        ground_height_percent: height,
        cap_cut: cap,
      },
    }));
    setSending(false);
    if (submitted) { mergeJob(submitted); setJobId(submitted.id); }
  }

  return (
    <div class="overlay cleanup-overlay" onClick={onClose}>
      <div class="modal cleanup-modal" role="dialog" aria-modal="true"
        aria-label={t("cleanup.title")} tabIndex={-1} ref={dialog}
        onClick={(event) => event.stopPropagation()}>
        <div class="row">
          <h2>{t("cleanup.title")}</h2>
          <button class="button small" onClick={onClose}>{t("viewer.close")}</button>
        </div>
        <p class="hint">{t("cleanup.about")}</p>
        <div class="cleanup-layout">
          <div class="cleanup-previews">
            <section>
              <h3>{t("cleanup.original")}</h3>
              <div class="preview"><AssetPreview asset={asset} /></div>
            </section>
            {result && <section>
              <h3>{t("cleanup.result")}</h3>
              <div class="preview"><AssetPreview key={result.id} asset={result} /></div>
              <a class="button" href={hrefLibrary(result.id)} onClick={onClose}>
                {t("cleanup.openResult")}
              </a>
            </section>}
          </div>
          <div class="cleanup-settings">
            <fieldset disabled={pending}>
              <legend>{t("cleanup.looseHeading")}</legend>
              <label class="cleanup-check"><input type="checkbox" checked={removeDebris}
                onChange={(event) => setRemoveDebris(event.currentTarget.checked)} />
                <span>{t("cleanup.removeLoose")}</span></label>
              {removeDebris && <div class="cleanup-options">
                <label class="cleanup-check"><input type="radio" name="cleanup-mode" checked={mode === "small"}
                  onChange={() => setMode("small")} /><span>{t("cleanup.small")}</span></label>
                <p class="hint">{t("cleanup.smallHint")}</p>
                <label class="cleanup-check"><input type="radio" name="cleanup-mode" checked={mode === "main"}
                  onChange={() => setMode("main")} /><span>{t("cleanup.main")}</span></label>
                {mode === "main" && <p class="hint cleanup-caution">{t("cleanup.mainHint")}</p>}
                {mode === "small" && <details>
                  <summary>{t("cleanup.sensitivity")}</summary>
                  <label class="field"><span>{t("cleanup.threshold")}</span>
                    <input type="number" min="0.01" max="10" step="0.1" value={threshold}
                      onInput={(event) => setThreshold(event.currentTarget.valueAsNumber)} />
                  </label>
                  <p class="hint">{t("cleanup.thresholdHint")}</p>
                </details>}
              </div>}
            </fieldset>
            <fieldset disabled={pending}>
              <legend>{t("cleanup.groundHeading")}</legend>
              <label class="cleanup-check"><input type="checkbox" checked={removeGround}
                onChange={(event) => setRemoveGround(event.currentTarget.checked)} />
                <span>{t("cleanup.trimGround")}</span></label>
              {removeGround && <div class="cleanup-options">
                <label class="field"><span>{t("cleanup.cutHeight", { n: height })}</span>
                  <input type="range" min="0" max="80" step="0.5" value={height}
                    aria-label={t("cleanup.cutHeightLabel")}
                    onInput={(event) => setHeight(event.currentTarget.valueAsNumber)} />
                </label>
                <p class="hint">{t("cleanup.groundHint")}</p>
                <label class="cleanup-check"><input type="checkbox" checked={cap}
                  onChange={(event) => setCap(event.currentTarget.checked)} />
                  <span>{t("cleanup.cap")}</span></label>
              </div>}
            </fieldset>
            {unavailable && <p class="hint error">{t("cleanup.unavailable")}</p>}
            <button class="button primary" disabled={pending || unavailable || !validThreshold || (!removeDebris && !removeGround)}
              onClick={() => void createCopy()}>
              {pending ? t("cleanup.working") : result ? t("cleanup.another") : t("cleanup.create")}
            </button>
            <div aria-live="polite">
              {job && isPending(job) && <p class="hint">{t("cleanup.pending")} <a href={hrefJobs} onClick={onClose}>{t("nav.jobs")}</a></p>}
              {job?.status === "succeeded" && <p class="hint">{t("cleanup.done")}</p>}
              {job?.status === "failed" && <p class="error">{job.error_message}</p>}
              {job?.status === "cancelled" && <p class="hint">{t("status.cancelled")}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModelCleanup({ asset }: { asset: Asset }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => setOpen(false), [asset.id]);
  if (asset.mime !== "model/gltf-binary") return null;
  return <>
    <button class="button small" onClick={() => setOpen(true)}>{t("cleanup.action")}</button>
    {open && <CleanupDialog key={asset.id} asset={asset} onClose={close} />}
  </>;
}
