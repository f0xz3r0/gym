export type BuilderFile = {
  name: string;
  kind: "blend" | "glb" | "image" | "source" | "text" | "json";
  label: string;
  url: string;
};

export type BuilderModel = {
  id: string;
  name: string;
  installed: boolean;
  vision: boolean;
  recommended: boolean;
  description: string;
  source?: string;
  size_gb?: number;
  downloadable?: boolean;
};

export type BuilderStatus = {
  available: boolean;
  blender: boolean;
  ollama: boolean;
  message?: string;
  models: BuilderModel[];
  active_job?: string;
};

export type BuilderJob = {
  id: string;
  prompt: string;
  model: string;
  kind?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string;
  message: string;
  created_at: string;
  updated_at: string;
  files: BuilderFile[];
  error?: string | null;
  title?: string;
  summary?: string;
  metrics?: Record<string, unknown>;
  controls?: (string | { object: string; properties: Record<string, number | string | boolean> })[];
  library_asset?: string;
  library_warning?: string;
  moving_parts?: boolean;
  detail?: "standard" | "detailed";
  repair_rounds?: 1 | 2 | 3;
  seed?: number;
  reference_asset?: string | null;
};

export type BuilderRequest = {
  prompt: string;
  model: string;
  moving_parts: boolean;
  detail: "standard" | "detailed";
  repair_rounds: 1 | 2 | 3;
  seed?: number;
  reference?: string;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/blender-builder${path}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Could not complete this request (${response.status}).`;
    try {
      const value = await response.json() as { detail?: unknown };
      if (typeof value.detail === "string") message = value.detail;
    } catch { /* Keep the useful HTTP status for non-JSON failures. */ }
    throw new Error(message);
  }
  return await response.json() as T;
}

export const blenderBuilder = {
  status: () => request<BuilderStatus>("/status"),
  jobs: () => request<{ jobs: BuilderJob[] }>("/jobs"),
  create: (body: BuilderRequest) => request<BuilderJob>("/jobs", body),
  cancel: (id: string) => request<BuilderJob>(`/jobs/${encodeURIComponent(id)}/cancel`, {}),
  open: (id: string) => request<{ opened: boolean }>(`/jobs/${encodeURIComponent(id)}/open`, {}),
  install: (model: string) => request<BuilderJob>("/models/install", { model }),
};
