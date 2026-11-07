// Typed calls to the viewer API (src/viewer/api.ts), and one hook for loading them.
import { useEffect, useState } from "react";
import type {
  ApiError,
  CallDetail,
  CallPage,
  GateRun,
  GateRunDetail,
  IncidentArm,
  LiveCall,
  LiveOptions,
  LiveStart,
  Summary,
} from "../../../src/viewer/types";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isApiError(v: unknown): v is ApiError {
  return typeof v === "object" && v !== null && "error" in v;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new RequestError(0, "offline", "The viewer API is not running. Start it with npm run viewer.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = isApiError(body) ? body.error : { code: "http", message: `HTTP ${res.status}` };
    throw new RequestError(res.status, e.code, e.message);
  }
  return body as T; // the server's types are the contract (src/viewer/types.ts)
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  summary: () => request<Summary>("/summary"),
  gateRuns: () => request<GateRun[]>("/gate-runs"),
  gateRun: (id: string) => request<GateRunDetail>(`/gate-runs/${encodeURIComponent(id)}`),
  incident: () => request<IncidentArm[]>("/incident"),
  calls: (params: URLSearchParams) => request<CallPage>(`/calls?${params.toString()}`),
  call: (id: string) => request<CallDetail>(`/calls/${encodeURIComponent(id)}`),
  liveOptions: () => request<LiveOptions>("/live/options"),
  liveStart: (body: LiveStart) => post<LiveCall>("/live/calls", body),
  liveSay: (id: string, text: string) => post<LiveCall>(`/live/calls/${encodeURIComponent(id)}/say`, { text }),
  liveHangUp: (id: string) => post<LiveCall>(`/live/calls/${encodeURIComponent(id)}/hangup`, {}),
};

export type Resource<T> = { state: "loading" } | { state: "error"; error: RequestError } | { state: "ready"; data: T };

// Loads once per key; a stale response for an old key is dropped.
export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [res, setRes] = useState<Resource<T>>({ state: "loading" });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    setRes({ state: "loading" });
    load().then(
      (data) => live && setRes({ state: "ready", data }),
      (e: unknown) => live && setRes({ state: "error", error: e instanceof RequestError ? e : new RequestError(0, "unknown", String(e)) }),
    );
    return () => {
      live = false;
    };
    // `load` is a fresh closure every render; the key names what it loads.
  }, [key]);
  return res;
}
