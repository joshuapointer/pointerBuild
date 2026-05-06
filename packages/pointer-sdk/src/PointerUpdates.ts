import { request } from './http.js';
import type {
  AppRecord,
  CheckResult,
  Platform,
  PointerSdkConfig,
  UpdateManifest,
  UpdateRecord,
} from './types.js';

export interface FetchManifestArgs {
  platform: Platform;
  runtimeVersion: string;
}

export interface HistoryQuery {
  platform?: Platform;
  runtimeVersion?: string;
  limit?: number;
  offset?: number;
}

export class PointerUpdates {
  private cfg: PointerSdkConfig;
  private currentUpdateId: string | null = null;

  constructor(cfg: PointerSdkConfig) {
    if (!cfg.apiBase) throw new Error('PointerUpdates: apiBase is required');
    if (!cfg.appId) throw new Error('PointerUpdates: appId is required');
    this.cfg = cfg;
  }

  private opts() {
    return {
      apiBase: this.cfg.apiBase,
      apiKey: this.cfg.apiKey,
      fetch: this.cfg.fetch,
      timeoutMs: this.cfg.timeoutMs ?? 15_000,
    };
  }

  setCurrentUpdateId(id: string | null): void {
    this.currentUpdateId = id;
  }

  async health(): Promise<{ ok: boolean }> {
    return request(this.opts(), '/health');
  }

  async listApps(): Promise<AppRecord[]> {
    return request(this.opts(), '/apps');
  }

  async registerApp(name: string, platform?: Platform): Promise<AppRecord> {
    return request(this.opts(), '/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.cfg.appId, name, platform }),
    });
  }

  async fetchManifest(args: FetchManifestArgs): Promise<UpdateManifest | null> {
    const { platform, runtimeVersion } = args;
    const path = `/updates/${encodeURIComponent(this.cfg.appId)}/${platform}/${encodeURIComponent(runtimeVersion)}`;
    try {
      return await request<UpdateManifest>(this.opts(), path);
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e?.status === 404) return null;
      throw err;
    }
  }

  async checkForUpdate(args: FetchManifestArgs): Promise<CheckResult> {
    const manifest = await this.fetchManifest(args);
    const hasUpdate = !!manifest && manifest.id !== this.currentUpdateId;
    return { hasUpdate, manifest };
  }

  async downloadBundle(manifest: UpdateManifest): Promise<ArrayBuffer> {
    const f = this.cfg.fetch ?? globalThis.fetch;
    const res = await f(manifest.bundleUrl);
    if (!res.ok) throw new Error(`bundle download failed: ${res.status}`);
    return res.arrayBuffer();
  }

  async checkAndDownload(args: FetchManifestArgs): Promise<{
    manifest: UpdateManifest | null;
    bundle: ArrayBuffer | null;
  }> {
    const { hasUpdate, manifest } = await this.checkForUpdate(args);
    if (!hasUpdate || !manifest) return { manifest: null, bundle: null };
    const bundle = await this.downloadBundle(manifest);
    return { manifest, bundle };
  }

  async history(query: HistoryQuery = {}): Promise<{ updates: UpdateRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (query.platform) params.set('platform', query.platform);
    if (query.runtimeVersion) params.set('runtimeVersion', query.runtimeVersion);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    const qs = params.toString();
    const path = `/apps/${encodeURIComponent(this.cfg.appId)}/history${qs ? `?${qs}` : ''}`;
    return request(this.opts(), path);
  }

  async deleteUpdate(updateId: string): Promise<void> {
    await request(this.opts(), `/updates/${encodeURIComponent(updateId)}`, { method: 'DELETE' });
  }

  async uploadBundle(args: {
    bundle: Blob | File;
    platform: Platform;
    version: string;
    runtimeVersion: string;
  }): Promise<UpdateRecord> {
    const form = new FormData();
    form.append('bundle', args.bundle as Blob);
    form.append('appId', this.cfg.appId);
    form.append('platform', args.platform);
    form.append('version', args.version);
    form.append('runtimeVersion', args.runtimeVersion);
    return request(this.opts(), '/updates', { method: 'POST', body: form });
  }
}
