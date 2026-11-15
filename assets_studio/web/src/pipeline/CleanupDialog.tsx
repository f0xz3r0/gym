// "Clean up…" on a game asset: per step, how many results are not in use and how big they are; delete them in one go.
import { useState } from "preact/hooks";

import type { GameAsset } from "./api";
import { deleteResults, megabytes, removable } from "./cleanup";
import { act, toast, worldOf } from "./state";
import { STEPS } from "./steps";
import { ConfirmButton, Modal } from "./ui";

export function CleanupDialog({ doc, onClose }: { doc: GameAsset; onClose: () => void }) {
  const world = worldOf(doc);
  const all = removable(world);
  const steps = STEPS.filter((step) => all.some((item) => item.step.id === step.id));
  const [ticked, setTicked] = useState<Set<string>>(new Set(steps.map((s) => s.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const chosen = all.filter((item) => ticked.has(item.step.id));
  return (
    <Modal title="Clean up" onClose={onClose}>
      <div class="cleanup">
        <p class="muted">
          Deletes every result that is not in use: each step keeps the one it uses (and what that one was made from).
          Deleting is for good: the files are removed. Pick and choose single results with <b>Select…</b> on a step.
        </p>
        {steps.length === 0 ? (
          <p>Nothing to clean up: every result is in use.</p>
        ) : (
          <ul class="cleanup-list">
            {steps.map((step) => {
              const items = all.filter((item) => item.step.id === step.id);
              return (
                <li key={step.id}>
                  <label class="check">
                    <input type="checkbox" checked={ticked.has(step.id)} onChange={() =>
                      setTicked((now) => {
                        const next = new Set(now);
                        if (next.has(step.id)) next.delete(step.id);
                        else next.add(step.id);
                        return next;
                      })} />
                    <span>{step.title}</span>
                  </label>
                  <span class="muted small">{items.length} not in use · {megabytes(items).toFixed(0)} MB</span>
                </li>
              );
            })}
          </ul>
        )}
        <div class="cleanup-actions">
          <span class="muted small">{chosen.length} results · {megabytes(chosen).toFixed(0)} MB</span>
          <span class="spacer" />
          <button class="button ghost" onClick={onClose}>Cancel</button>
          {chosen.length > 0 && (
            <ConfirmButton
              class="primary"
              label={busy ?? `Delete ${chosen.length}`}
              confirm={`Delete ${chosen.length} for good? Click again`}
              onConfirm={() => {
                if (busy) return;
                setBusy("Deleting…");
                void act(async () => {
                  const { deleted } = await deleteResults(doc, chosen, (done, total) => setBusy(`Deleting ${done}/${total}…`));
                  toast(`Cleaned up: ${deleted} results deleted.`, "good");
                  onClose();
                }).finally(() => setBusy(null));
              }}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
