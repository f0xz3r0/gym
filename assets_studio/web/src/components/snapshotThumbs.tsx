// Still thumbnails for 3D results. A live <model-viewer> per thumbnail downloaded and decoded every GLB on the page
// (an animal with 39 results of ~50 MB each: 1.5 GB, and the page stuttered on every click, 2026-11-14). Now each
// GLB is rendered once, one at a time and only when its thumbnail is on screen, to a small WebP kept in IndexedDB
// (per browser; assets never change, so the id is the key). After that the thumbnail is a plain <img>.
import { useEffect, useRef, useState } from "preact/hooks";

import type { Asset } from "../api/client";
import { clayIfShapeOnly, useModelViewer } from "./AssetPreview";

const DB = "asset-studio-thumbs";
const STORE = "thumbs";
const SIZE = 160;
const memory = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

async function readThumb(id: string): Promise<string | undefined> {
  if (memory.has(id)) return memory.get(id);
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => {
        const blob = req.result as Blob | undefined;
        if (!blob) return resolve(undefined);
        const url = URL.createObjectURL(blob);
        memory.set(id, url);
        resolve(url);
      };
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function writeThumb(id: string, blob: Blob) {
  memory.set(id, URL.createObjectURL(blob));
  const d = await db();
  try {
    d?.transaction(STORE, "readwrite").objectStore(STORE).put(blob, id);
  } catch {
    /* no storage: the thumbnail is made again next visit */
  }
}

// one render at a time, in the order thumbnails came on screen
const queue: Array<() => void> = [];
let busy = false;
function take(start: () => void) {
  queue.push(start);
  pump();
}
function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  next();
}
function release() {
  busy = false;
  setTimeout(pump, 60);           // a breath for the page between renders
}

type Viewer = HTMLElement & { toBlob?: (o?: { mimeType?: string; qualityArgument?: number; idealAspect?: boolean }) => Promise<Blob> };

/** A still of a GLB: from the cache, else rendered once (queued) when on screen. */
export function SnapshotThumb({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState<string | undefined>(memory.get(asset.id));
  const [turn, setTurn] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const viewer = useRef<Viewer>(null);
  const holding = useRef(false);           // this thumbnail holds the queue
  const ready = useModelViewer(turn);
  const finish = (ok: boolean) => {
    if (!ok) setFailed(true);
    setTurn(false);
    if (holding.current) {
      holding.current = false;
      release();
    }
  };
  // a render that never finishes (a broken file, a hidden tab) gives the queue back after 30 s
  useEffect(() => {
    if (!turn) return;
    const timer = setTimeout(() => finish(false), 30000);
    return () => clearTimeout(timer);
  }, [turn]);

  useEffect(() => {
    if (url) return;
    let alive = true;
    let queued = false;
    void readThumb(asset.id).then((cached) => {
      if (!alive) return;
      if (cached) return setUrl(cached);
      const el = box.current;
      if (!el) return;
      const seen = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting) || queued) return;
        queued = true;
        seen.disconnect();
        take(() => {
          if (!alive) return release();
          holding.current = true;
          setTurn(true);
        });
      }, { rootMargin: "200px" });
      seen.observe(el);
      cleanup = () => seen.disconnect();
    });
    let cleanup = () => {};
    return () => {
      alive = false;
      cleanup();
      if (holding.current) {
        holding.current = false;
        release();
      }
    };
  }, [asset.id]);

  if (url) return <img class="snapshot-thumb" src={url} alt="" loading="lazy" draggable={false} />;
  return (
    <span class="snapshot-pending" ref={box}>
      {turn && ready && !failed ? (
        <model-viewer
          ref={viewer as never}
          src={asset.file_url}
          loading="eager"
          interaction-prompt="none"
          shadow-intensity="0"
          style={{ width: `${SIZE}px`, height: `${SIZE}px` }}
          onLoad={async (event: Event) => {
            clayIfShapeOnly(asset)?.(event);
            try {
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              const blob = await viewer.current?.toBlob?.({ mimeType: "image/webp", qualityArgument: 0.85, idealAspect: false });
              if (blob) {
                await writeThumb(asset.id, blob);
                setUrl(memory.get(asset.id));
                finish(true);
              } else finish(false);
            } catch {
              finish(false);
            }
          }}
          onError={() => finish(false)}
        />
      ) : (
        <span class="thumb-icon">{failed ? "◆" : "…"}</span>
      )}
    </span>
  );
}
