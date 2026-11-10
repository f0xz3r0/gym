// The pipeline UI: game assets from idea to Godot. Served at "/"; the original
// studio UI stays at "/classic".
import "./style.css";

import { signal } from "@preact/signals";
import { render } from "preact";
import { useEffect } from "preact/hooks";

import { activeJobs, connect, connected, notice, servers } from "../state/store";
import { AssetPage } from "./AssetPage";
import { Home } from "./Home";
import { ModelsPage, QueuePage } from "./Pages";
import { act, loadDocs, toasts } from "./state";
import { Dot } from "./ui";

type Route = { page: "home" } | { page: "asset"; id: string } | { page: "queue" } | { page: "models" };

function parse(hash: string): Route {
  const [page, id] = hash.replace(/^#\/?/, "").split("/");
  if (page === "a" && id) return { page: "asset", id: decodeURIComponent(id) };
  if (page === "queue") return { page: "queue" };
  if (page === "models") return { page: "models" };
  return { page: "home" };
}

const route = signal<Route>(parse(window.location.hash));
window.addEventListener("hashchange", () => {
  route.value = parse(window.location.hash);
  window.scrollTo(0, 0);
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
        <a href="#/" class={current.page === "home" || current.page === "asset" ? "active" : ""}>
          Assets
        </a>
        <a href="#/queue" class={current.page === "queue" ? "active" : ""}>
          Queue {busy > 0 && <span class="badge">{busy}</span>}
        </a>
        <a href="#/models" class={current.page === "models" ? "active" : ""} title={down ? `${down} not running` : "All models are up"}>
          <Dot state={overallState()} /> Models
        </a>
      </nav>
      <span class="spacer" />
      <a class="ghost-link" href="/classic#/tool/blender-builder" target="_blank" rel="noreferrer">
        Build in Blender ↗
      </a>
      <a class="ghost-link" href="/classic" target="_blank" rel="noreferrer">
        Classic studio ↗
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
      <main>
        {current.page === "asset" ? (
          <AssetPage key={current.id} id={current.id} />
        ) : current.page === "queue" ? (
          <QueuePage />
        ) : current.page === "models" ? (
          <ModelsPage />
        ) : (
          <Home />
        )}
      </main>
      <Toasts />
    </div>
  );
}

connect();
const root = document.getElementById("app");
if (root) render(<App />, root);
