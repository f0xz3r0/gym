// Add an existing result to a step: pick from the studio library or upload a file.
import { useEffect, useRef, useState } from "preact/hooks";

import { api, type Asset } from "../api/client";
import { putAssets } from "../state/store";
import { act } from "./state";
import { Thumb } from "./Preview";
import { Modal } from "./ui";

const ACCEPT: Record<string, string> = {
  image: "image/png,image/jpeg,image/webp",
  mesh: ".glb,model/gltf-binary",
};

export function Picker({
  kind,
  title,
  onPick,
  onUpload,
  onClose,
}: {
  kind: "image" | "mesh";
  title: string;
  onPick: (asset: Asset) => void;
  onUpload: (file: File) => Promise<unknown>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Asset[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void act(() => api.assets({ kind, limit: 300 })).then((list) => {
      putAssets(list ?? []);
      setItems((list ?? []).filter((asset) => kind !== "mesh" || asset.mime === "model/gltf-binary"));
    });
  }, [kind]);
  const shown = (items ?? []).filter((asset) =>
    (asset.title ?? "").toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <Modal title={title} onClose={onClose} wide>
      <div class="picker-tools">
        <input
          type="search"
          placeholder="Search by name…"
          value={filter}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <button class="button" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? "Uploading…" : "Upload a file…"}
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept={ACCEPT[kind]}
          onChange={(event) => {
            const chosen = event.currentTarget.files?.[0];
            if (!chosen) return;
            setBusy(true);
            void act(() => onUpload(chosen)).then(() => {
              setBusy(false);
              onClose();
            });
          }}
        />
      </div>
      {items === null ? (
        <p class="muted">Loading the library…</p>
      ) : shown.length === 0 ? (
        <p class="muted">Nothing matches.</p>
      ) : (
        <div class="picker-grid">
          {shown.map((asset) => (
            <button
              key={asset.id}
              class="picker-item"
              onClick={() => {
                onPick(asset);
                onClose();
              }}
            >
              <span class="thumb">
                <Thumb asset={asset} />
              </span>
              <span class="picker-name">{asset.title ?? "Untitled"}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
