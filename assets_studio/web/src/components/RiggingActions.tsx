import type { Asset, Server } from "../api/client";
import { chooseServer, chooseTask, updateDraft } from "../state/drafts";
import { go, hrefSection } from "../state/router";
import { sections } from "../state/sections";
import { servers } from "../state/store";

/** Open the correct task with this asset selected; settings remain reviewable. */
function openTask(asset: Asset, server: Server, taskName: string, role: string) {
  const section = sections.value.find((candidate) => candidate.tasks.includes(taskName));
  if (!section) return;
  chooseTask(section, taskName);
  chooseServer(section, server.id);
  updateDraft(section, { inputs: { [role]: asset.id }, prompt: "" });
  go(hrefSection(section.id));
}

export function RiggingActions({ asset }: { asset: Asset }) {
  if (!["model/gltf-binary", "model/x-fbx"].includes(asset.mime)) return null;
  const riggers = servers.value.filter((server) => server.tasks.some((task) =>
    task.task === "3d-to-rig" && task.inputs.some((input) => input.mime.includes(asset.mime))));
  const animator = servers.value.find((server) => server.tasks.some((task) => task.task === "rig-motion"));
  const videoAnimator = servers.value.find((server) => server.tasks.some((task) =>
    task.task === "video-to-motion" && task.inputs.some((input) =>
      input.role === "rig" && input.mime.includes(asset.mime))));
  const rigged = asset.meta.rigged === true || (typeof asset.meta.bones === "number" && asset.meta.bones > 0);
  return <>
    {riggers.map((server) => {
      const spec = server.tasks.find((task) => task.task === "3d-to-rig");
      const role = spec?.inputs.find((input) => input.mime.includes(asset.mime))?.role;
      return role && <button key={server.id} class="button small"
        disabled={["error", "unavailable"].includes(server.state)}
        title="Add a skeleton and skin weights; review the rig before animating"
        onClick={() => openTask(asset, server, "3d-to-rig", role)}>
        {riggers.length > 1 ? `Rig with ${server.title}…` : "Rig…"}
      </button>;
    })}
    {animator && <button class="button small"
      disabled={["error", "unavailable"].includes(animator.state)}
      title="Rotate any asset, check a rig, or animate named joints"
      onClick={() => openTask(asset, animator, "rig-motion", "rig")}>
      Animate…
    </button>}
    {rigged && videoAnimator && <button class="button small"
      disabled={["error", "unavailable"].includes(videoAnimator.state)}
      title="Use a short video with a compatible humanoid or quadruped rig"
      onClick={() => openTask(asset, videoAnimator, "video-to-motion", "rig")}>
      Motion from video…
    </button>}
  </>;
}
