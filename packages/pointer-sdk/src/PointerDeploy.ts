import { request } from './http.js';
import type {
  BuildRecord,
  ChannelRecord,
  DownloadUrlResponse,
  Platform,
  PointerDeployConfig,
  RegisterBuildInput,
} from './types.js';

export interface ListBuildsQuery {
  platform?: Platform;
  branch?: string;
  limit?: number;
  offset?: number;
}

export class PointerDeploy {
  private cfg: PointerDeployConfig;

  constructor(cfg: PointerDeployConfig) {
    if (!cfg.apiBase) throw new Error('PointerDeploy: apiBase is required');
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

  async health(): Promise<{ ok: boolean }> {
    return request(this.opts(), '/health');
  }

  async registerBuild(input: RegisterBuildInput): Promise<BuildRecord> {
    return request(this.opts(), '/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async listBuilds(
    appId: string,
    query: ListBuildsQuery = {},
  ): Promise<{ builds: BuildRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (query.platform) params.set('platform', query.platform);
    if (query.branch) params.set('branch', query.branch);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    const qs = params.toString();
    return request(this.opts(), `/builds/${encodeURIComponent(appId)}${qs ? `?${qs}` : ''}`);
  }

  async latestBuilds(
    appId: string,
  ): Promise<{ ios: BuildRecord | null; android: BuildRecord | null }> {
    return request(this.opts(), `/builds/${encodeURIComponent(appId)}/latest`);
  }

  async downloadUrl(buildId: string): Promise<DownloadUrlResponse> {
    return request(this.opts(), `/builds/${encodeURIComponent(buildId)}/download`);
  }

  async promote(buildId: string, channel: string): Promise<ChannelRecord> {
    return request(this.opts(), `/builds/${encodeURIComponent(buildId)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
  }

  async listChannels(appId: string): Promise<ChannelRecord[]> {
    return request(this.opts(), `/channels/${encodeURIComponent(appId)}`);
  }

  async latestOnChannel(appId: string, channel: string): Promise<BuildRecord | null> {
    try {
      return await request<BuildRecord>(
        this.opts(),
        `/channels/${encodeURIComponent(appId)}/${encodeURIComponent(channel)}/latest`,
      );
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e?.status === 404) return null;
      throw err;
    }
  }

  async createChannel(appId: string, channel: string, buildId: string): Promise<ChannelRecord> {
    return request(this.opts(), '/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, channel, buildId }),
    });
  }

  async deleteBuild(buildId: string): Promise<void> {
    await request(this.opts(), `/builds/${encodeURIComponent(buildId)}`, { method: 'DELETE' });
  }
}
