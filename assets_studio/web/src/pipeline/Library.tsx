// The library: every asset the studio has, to find, judge, fix and reuse. Search and filters on the left, the
// selected asset on the right (its preview with tabs, how it was made, what it was made from, which game asset
// uses it, rating, tags, actions). Routes: #/library and #/library/<asset id> (← / → step through the list).
import { useEffect, useRef, useState } from "preact/hooks";

import { api, type Asset, type Parent } from "../api/client";
import {
  DeleteButton,
  FavoriteButton,
  RatingButtons,
  RemoveBackgroundButtons,
} from "../components/AssetActions";
import { ModelCleanup } from "../components/ModelCleanup";
import { Provenance } from "../components/Provenance";
import { Tags } from "../components/Tags";
import { assetName, bytes, isMotionAsset, time } from "../format";
import { assetById, assets, attempt, jobs, putAsset, putAssets, succeededJobs } from "../state/store";
import { facts, Preview, Thumb } from "./Preview";
import { docs } from "./state";
import { stepById } from "./steps";

type Kind = "all" | "image" | "mesh" | "animation" | "video" | "text" | "favorite";
const KINDS: { id: Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "mesh", label: "3D models" },
  { id: "animation", label: "Animations" },
  { id: "video", label: "Videos" },
  { id: "text", label: "Text" },
  { id: "favorite", label: "★ Favourites" },
];
const PAGE = 120;

export const hrefLib = (id?: string) => (id ? `#/library/${encodeURIComponent(id)}` : "#/library");

/** Animated: a motion asset, or a model with an animation from a pipeline step. */
function animated(asset: Asset) {
  const meta = asset.meta as Record<string, unknown>;
  return isMotionAsset(asset) || meta.animated === true;
}

/** A readable name: its title, else what it shows (a motion, a creature, a step's result), else kind and date. */
export function displayName(asset: Asset) {
  if (asset.title) return asset.title;
  const meta = asset.meta as Record<string, unknown>;
  const text = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : "");
  if (text("move")) return `${text("move")} · ${text("creature") || "motion"}`;
  if (text("creature_folder")) return `${text("creature_folder")} · rig`;
  if (text("effective_prompt")) return text("effective_prompt").slice(0, 60);
  return assetName(asset);
}

/** The game assets (pipeline pages) that use an asset, and in which step. */
function usedIn(asset: Asset, jobOutputs: Map<string, string>) {
  const out: { doc: string; name: string; step: string }[] = [];
  for (const doc of docs.value.values())
    for (const [stepId, state] of Object.entries(doc.steps)) {
      const mine =
        (state.extra ?? []).includes(asset.id) ||
        state.reference === asset.id ||
        (state.jobs ?? []).some((job) => jobOutputs.get(job) === asset.id);
      if (mine) out.push({ doc: doc.id, name: doc.name, step: stepById(stepId)?.title ?? stepId });
    }
  return out;
}

export function LibraryPage({ selectedId }: { selectedId: string | null }) {
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [rating, setRating] = useState<"any" | "unrated" | "3" | "4" | "5">("any");
  const [limit, setLimit] = useState(PAGE);
  const [ids, setIds] = useState<string[] | null>(null);
  const finished = succeededJobs.value;

  useEffect(() => {
    let current = true;
    const query =
      kind === "favorite"
        ? { favorite: true }
        : kind === "all" || kind === "animation"
          ? {}
          : kind === "mesh"
            ? { kind: "mesh" }
            : { kind };
    const scored = rating === "any" ? {} : rating === "unrated" ? { unrated: true } : { minRating: Number(rating) };
    void attempt(() => api.assets({ ...query, ...scored, tags, limit })).then((list) => {
      if (!current) return;
      putAssets(list ?? []);
      setIds(list?.map((asset) => asset.id) ?? []);
    });
    return () => {
      current = false;
    };
  }, [kind, tags, rating, limit, finished]);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const listed = (ids ?? []).flatMap((id) => {
    const asset = assets.value.get(id);
    if (!asset || asset.deleted_at) return [];
    if (kind === "animation" && !animated(asset)) return [];
    if (kind === "mesh" && animated(asset)) return [];
    if (words.length) {
      const text = [displayName(asset), asset.mime, ...asset.tags, JSON.stringify(asset.meta ?? {})]
        .join(" ")
        .toLowerCase();
      if (!words.every((word) => text.includes(word))) return [];
    }
    return [asset];
  });
  const shown = listed.map((asset) => asset.id);
  const selected = selectedId ? assetById(selectedId) : undefined;

  // ← / → step through the list (not while typing)
  const at = useRef(selectedId);
  at.current = selectedId;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const next = (at.current ? shown.indexOf(at.current) : -1) + (event.key === "ArrowRight" ? 1 : -1);
      if (next >= 0 && next < shown.length) window.location.hash = hrefLib(shown[next]);
      else if (next >= shown.length && ids?.length === limit) setLimit(limit + PAGE);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown.join(), ids, limit]);

  return (
    <div class="library">
      <section class="library-list">
        <div class="library-tools">
          <input
            type="search"
            placeholder="Search names, tags, prompts…"
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <div class="segmented wrap" role="group" aria-label="Kind">
            {KINDS.map((item) => (
              <button
                key={item.id}
                class="button small"
                aria-pressed={kind === item.id}
                onClick={() => {
                  setIds(null);
                  setLimit(PAGE);
                  setKind(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div class="row">
            <label class="inline">
              <span class="muted small">Rating</span>
              <select value={rating} onChange={(event) => setRating(event.currentTarget.value as typeof rating)}>
                <option value="any">any</option>
                <option value="5">★★★★★</option>
                <option value="4">★★★★ or more</option>
                <option value="3">★★★ or more</option>
                <option value="unrated">not rated</option>
              </select>
            </label>
            {tags.map((tag) => (
              <button key={tag} class="chip" title="Remove this filter" onClick={() => setTags(tags.filter((t) => t !== tag))}>
                #{tag} ✕
              </button>
            ))}
            <span class="spacer" />
            <span class="muted small">{ids === null ? "Loading…" : `${listed.length} shown`}</span>
          </div>
        </div>
        <div class="library-grid" role="list">
          {listed.map((asset) => (
            <a
              key={asset.id}
              role="listitem"
              href={hrefLib(asset.id)}
              class={`library-card${asset.id === selectedId ? " selected" : ""}`}
              title={displayName(asset)}
            >
              <span class="thumb">
                <Thumb asset={asset} />
              </span>
              <span class="library-card-name">{displayName(asset)}</span>
              <span class="library-card-badges">
                {asset.favorite && <span title="Favourite">★</span>}
                {typeof asset.rating === "number" && <span title="Rating">{"★".repeat(asset.rating)}</span>}
                {animated(asset) && <span title="Animated">▶</span>}
              </span>
            </a>
          ))}
          {ids !== null && listed.length === 0 && <p class="muted">Nothing matches. Clear the search or a filter.</p>}
        </div>
        {ids !== null && ids.length === limit && (
          <button class="button" onClick={() => setLimit(limit + PAGE)}>
            Show more
          </button>
        )}
      </section>
      <section class="library-detail">
        {selected ? (
          <Details asset={selected} onPickTag={(tag) => !tags.includes(tag) && setTags([...tags, tag])} />
        ) : (
          <div class="preview-empty">Pick an asset to see it, how it was made and what you can do with it.</div>
        )}
      </section>
    </div>
  );
}

function Details({ asset, onPickTag }: { asset: Asset; onPickTag: (tag: string) => void }) {
  const [parents, setParents] = useState<Parent[]>([]);
  const [title, setTitle] = useState(asset.title ?? "");
  useEffect(() => {
    setTitle(asset.title ?? "");
    void attempt(() => api.lineage(asset.id)).then((list) => setParents(list ?? []));
  }, [asset.id, asset.title]);
  const outputs = new Map<string, string>();
  for (const doc of docs.value.values())
    for (const state of Object.values(doc.steps))
      for (const id of state.jobs ?? []) {
        const job = jobs.value.get(id);
        for (const out of job?.outputs ?? []) if (out === asset.id) outputs.set(id, out);
      }
  const used = usedIn(asset, outputs);
  const isMesh = asset.mime === "model/gltf-binary";

  async function rename() {
    if (title === (asset.title ?? "")) return;
    const updated = await attempt(() => api.updateAsset(asset.id, { title }));
    if (updated) putAsset(updated);
  }
  async function retag(next: string[]) {
    const updated = await attempt(() => api.updateAsset(asset.id, { tags: next }));
    if (updated) putAsset(updated);
  }

  return (
    <div class="library-detail-inner">
      <div class="preview-box library-preview">
        <Preview asset={asset} />
      </div>
      <input
        class="library-title"
        type="text"
        aria-label="Name"
        value={title}
        placeholder={displayName(asset)}
        onInput={(event) => setTitle(event.currentTarget.value)}
        onBlur={() => void rename()}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      />
      <p class="muted small">{facts(asset).join(" · ")}</p>
      <div class="actions row wrap">
        <a class="button small" href={asset.file_url} download>
          Download
        </a>
        <FavoriteButton asset={asset} />
        <RatingButtons asset={asset} />
        {isMesh && <ModelCleanup asset={asset} />}
        {asset.kind === "image" && <RemoveBackgroundButtons asset={asset} />}
        <span class="spacer" />
        <DeleteButton asset={asset} />
      </div>
      {used.length > 0 && (
        <p class="small">
          Used in{" "}
          {used.map((item, index) => (
            <span key={item.doc + item.step}>
              {index > 0 && ", "}
              <a href={`#/a/${item.doc}`}>
                <b>{item.name}</b> · {item.step}
              </a>
            </span>
          ))}
        </p>
      )}
      <Tags tags={asset.tags} label="Tags" onChange={(next) => void retag(next)} onPick={onPickTag} />
      <dl class="meta">
        <dt>File</dt>
        <dd>
          {asset.mime} · {bytes(asset.size_bytes)}
        </dd>
        <dt>Created</dt>
        <dd>{time(asset.created_at)}</dd>
        {asset.source_url && (
          <>
            <dt>Source</dt>
            <dd>{asset.source_url}</dd>
          </>
        )}
      </dl>
      {parents.length > 0 && (
        <div class="field">
          <span>Made from</span>
          <div class="candidates row wrap">
            {parents.map((parent) => (
              <a key={parent.asset_id} class="library-parent" href={hrefLib(parent.asset_id)} title="Open the source">
                <Thumb asset={assetById(parent.asset_id)} />
              </a>
            ))}
          </div>
        </div>
      )}
      <Provenance asset={asset} />
    </div>
  );
}
