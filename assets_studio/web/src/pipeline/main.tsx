// The studio UI (v2): scene plans, game assets from idea to Godot, the library of everything made, the queue, the models and
// the tools (Blender builder, video frames). Served at "/".
import "./style.css";

import { signal } from "@preact/signals";
import { render } from "preact";
import { useEffect } from "preact/hooks";

import { activeJobs, connect, connected, notice, servers } from "../state/store";
import { AssetPage } from "./AssetPage";
import { Home } from "./Home";
import { ModelsPage, QueuePage } from "./Pages";
import { LibraryPage } from "./Library";
import { BlenderBuilderPage } from "../pages/BlenderBuilderPage";
import { FramesPage } from "./Frames";
import { JointEditor } from "./JointEditor";
import { PerfSummary, PerformanceColumn, usePerformancePolling } from "./Performance";
import { ScenePage, ScenesHome } from "./ScenePlans";
import { act, loadDocs, toasts } from "./state";
import { Dot } from "./ui";

type Route =
  | { page: "home" }
  | { page: "asset"; id: string }
  | { page: "rig"; id: string; folder: string }
  | { page: "scenes" }
  | { page: "scene"; id: string }
  | { page: "queue" }
  | { page: "models" }
  | { page: "library"; id: string | null }
  | { page: "builder" }
  | { page: "frames" };

function parse(hash: string): Route {
  const [page, id, extra] = hash.replace(/^#\/?/, "").split("/");
  if (page === "rig" && id && extra) return { page: "rig", id: decodeURIComponent(id), folder: decodeURIComponent(extra) };
  if (page === "a" && id) return { page: "asset", id: decodeURIComponent(id) };
  if (page === "s" && id) return { page: "scene", id: decodeURIComponent(id) };
  if (page === "scenes") return { page: "scenes" };
  if (page === "queue" || page === "jobs") return { page: "queue" };
  if (page === "library") return { page: "library", id: id ? decodeURIComponent(id) : null };
  if (page === "builder" || (page === "tool" && id === "blender-builder")) return { page: "builder" };
  if (page === "frames" || (page === "tool" && id === "frame")) return { page: "frames" };
  if (page === "models") return { page: "models" };
  return { page: "home" };
}

const route = signal<Route>(parse(window.location.hash));
window.addEventListener("hashchange", () => {
  const before = route.value.page;
  route.value = parse(window.location.hash);
  if (!(before === "library" && route.value.page === "library")) window.scrollTo(0, 0);
});

function overallState() {
  const list = servers.value;
  if (!list.length) return "unavailable";
  if (list.some((server) => server.state === "error")) return "error";
  if (list.every((server) => server.state === "ready" || server.state === "busy")) return "ready";
  return "loading";
}

function TopBar() {
  const current = route.value;
  const busy = activeJobs.value;
  const down = servers.value.filter((server) => server.state === "unavailable" || server.state === "error").length;
  return (
    <header class="topbar">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true">◆</span> Asset Studio
      </a>
      <nav>
        <a href="#/scenes" class={current.page === "scenes" || current.page === "scene" ? "active" : ""}>
          Scenes
        </a>
        <a href="#/" class={current.page === "home" || current.page === "asset" || current.page === "rig" ? "active" : ""}>
          Assets
        </a>
        <a href="#/library" class={current.page === "library" ? "active" : ""}>
          Library
        </a>
        <a href="#/queue" class={current.page === "queue" ? "active" : ""}>
          Queue {busy > 0 && <span class="badge">{busy}</span>}
        </a>
        <a href="#/models" class={current.page === "models" ? "active" : ""} title={down ? `${down} not running` : "All models are up"}>
          <Dot state={overallState()} /> Models
        </a>
      </nav>
      <PerfSummary />
      <span class="spacer" />
      <a class="ghost-link" href="#/frames" title="Save any frame of a video as an image">
        Video frames
      </a>
      <a class="ghost-link" href="#/builder" title="Build a prop procedurally in Blender">
        Build in Blender
      </a>
    </header>
  );
}

function Toasts() {
  const legacy = notice.value; // errors reported by shared studio helpers
  return (
    <div class="toasts" role="status" aria-live="polite">
      {legacy && <div class={`toast ${legacy.error ? "error" : "info"}`}>{legacy.text}</div>}
      {toasts.value.map((item) => (
        <div key={item.id} class={`toast ${item.tone}`}>
          {item.text}
        </div>
      ))}
    </div>
  );
}

function App() {
  usePerformancePolling();
  useEffect(() => {
    void act(loadDocs);
    // Another window may have changed documents: refresh when coming back.
    const onFocus = () => void loadDocs().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const current = route.value;
  return (
    <div class="shell">
      <TopBar />
      {!connected.value && (
        <div class="offline">Lost connection to the studio. Is it running? Retrying…</div>
      )}
      <div class="shell-body">
      <PerformanceColumn />
      <main>
        {current.page === "asset" ? (
          <AssetPage key={current.id} id={current.id} />
        ) : current.page === "rig" ? (
          <JointEditor key={current.folder} docId={current.id} folder={current.folder} />
        ) : current.page === "scenes" ? (
          <ScenesHome />
        ) : current.page === "scene" ? (
          <ScenePage key={current.id} id={current.id} />
        ) : current.page === "queue" ? (
          <QueuePage />
        ) : current.page === "models" ? (
          <ModelsPage />
        ) : current.page === "library" ? (
          <LibraryPage selectedId={current.id} />
        ) : current.page === "builder" ? (
          <div class="tool-page">
            <BlenderBuilderPage />
          </div>
        ) : current.page === "frames" ? (
          <FramesPage />
        ) : (
          <Home />
        )}
      </main>
      </div>
      <Toasts />
    </div>
  );
}

connect();
const root = document.getElementById("app");
if (root) render(<App />, root);
