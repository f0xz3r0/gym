// Video frames: pick a video from the library (or upload one), scrub to any frame and save it as an image asset
// made from the video (then use it as a concept's reference picture, or anywhere an image goes). No model runs.
import { useState } from "preact/hooks";

import { api, type Asset } from "../api/client";
import { VideoPreview } from "../components/AssetPreview";
import { assetById, putAsset } from "../state/store";
import { displayName } from "./Library";
import { Picker } from "./Picker";

export function FramesPage() {
  const [id, setId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const video = id ? assetById(id) : undefined;
  return (
    <div class="tool-page frames-page">
      <header class="page-head">
        <h1>Video frames</h1>
        <p class="muted">
          Save any frame of a video as an image in the library: a reference picture for a concept, a pose to copy, a
          still for a review. Saved frames remember the video they came from.
        </p>
      </header>
      <div class="row">
        <button class={`button${video ? "" : " primary"}`} onClick={() => setChoosing(true)}>
          {video ? "Pick another video…" : "Pick a video…"}
        </button>
        {video && <span class="muted">{displayName(video)}</span>}
      </div>
      {video && !video.deleted_at ? (
        <div class="frames-video">
          <VideoPreview key={video.id} asset={video} />
        </div>
      ) : (
        <div class="preview-empty frames-empty">Pick a video from the library, or upload one.</div>
      )}
      {choosing && (
        <Picker
          kind="video"
          title="A video to take frames from"
          onPick={(picked: Asset) => {
            setId(picked.id);
            setChoosing(false);
          }}
          onUpload={async (file) => {
            const uploaded = await api.upload(file, file.name);
            putAsset(uploaded);
            setId(uploaded.id);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}
