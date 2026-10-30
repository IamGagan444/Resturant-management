import type { HubSnapshot, SyncResult } from "@rms/contracts";
import type { Store } from "./store";

export interface CloudConfig {
  cloudUrl: string;
  token: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

const BATCH = 500;

/**
 * The hub's link to the cloud. Each tick:
 *   1. replay queued commands (oldest first; a batch is removed only once the cloud answered)
 *   2. when nothing is left to replay, take a fresh snapshot
 * Any network failure just marks the cloud offline; the next tick tries again.
 */
export class CloudLink {
  online = false;
  private running = false;

  constructor(
    private cfg: CloudConfig,
    private readonly store: Store,
  ) {}

  /** Tests point the hub at a dead address to simulate an outage. */
  setCloudUrl(url: string) {
    this.cfg = { ...this.cfg, cloudUrl: url };
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.cloudUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.cfg.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ""));
    return (await res.json()) as T;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const s = this.store.state;
      while (s.outbox.length) {
        const batch = s.outbox.slice(0, BATCH);
        const { results } = await this.call<SyncResult>("POST", "/v1/hub/sync", { commands: batch });
        for (const r of results) if (r.outcome === "REJECTED") this.cfg.log?.(`cloud refused ${r.clientId}: ${r.reason ?? ""}`);
        const done = new Set(batch.map((b) => b.clientId));
        s.outbox = s.outbox.filter((c) => !done.has(c.clientId));
        this.store.save();
      }
      const version = s.version;
      const snap = await this.call<HubSnapshot>("GET", "/v1/hub/snapshot");
      // a device changed something while the snapshot was in flight: keep the local view, refresh next tick
      if (s.version === version && s.outbox.length === 0) s.snapshot = snap;
      s.lastSyncAt = new Date().toISOString();
      if (!this.online) this.cfg.log?.("cloud reachable");
      this.online = true;
      this.store.save();
    } catch (e) {
      if (this.online) this.cfg.log?.(`cloud unreachable: ${e instanceof Error ? e.message : String(e)}`);
      this.online = false;
      if (e instanceof HttpError && e.status === 401) this.cfg.log?.("cloud rejected HUB_TOKEN: pair the hub again from Manage → Devices");
    } finally {
      this.running = false;
    }
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status} ${body.slice(0, 200)}`);
  }
}
