import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import fs from 'fs-extra';
import FormData from 'form-data';
import { PointerConfig, resolveApiKey, resolveGithubToken } from '../config.js';

export interface BuildRecord {
  id: string;
  appId: string;
  platform: 'ios' | 'android';
  version: string;
  buildNumber: number;
  artifactUrl: string;
  branch?: string;
  commitSha?: string;
  status?: string;
  createdAt?: string;
}

export interface UpdateRecord {
  id: string;
  appId: string;
  platform: string;
  version: string;
  runtimeVersion: string;
  bundlePath?: string;
  status?: string;
  createdAt?: string;
}

export interface ChannelRecord {
  id: string;
  appId: string;
  channel: string;
  buildId: string;
  build?: BuildRecord;
  createdAt?: string;
}

export class PointerClient {
  readonly updates: AxiosInstance;
  readonly deploy: AxiosInstance;

  constructor(private readonly config: PointerConfig, private readonly apiKey?: string) {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    this.updates = axios.create({ baseURL: config.updatesUrl, headers });
    this.deploy = axios.create({ baseURL: config.deployUrl, headers });
  }

  static async create(config: PointerConfig): Promise<PointerClient> {
    const apiKey = await resolveApiKey();
    return new PointerClient(config, apiKey);
  }

  async healthUpdates(): Promise<boolean> {
    try {
      const r = await this.updates.get('/health', { timeout: 5000 });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  async healthDeploy(): Promise<boolean> {
    try {
      const r = await this.deploy.get('/health', { timeout: 5000 });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  async registerApp(appId: string, name: string, platform = 'all'): Promise<void> {
    await this.updates.post('/apps', { appId, name, platform }).catch((err) => {
      if (err?.response?.status !== 409) throw err;
    });
  }

  async listBuilds(appId: string, params: { platform?: string; branch?: string; limit?: number; offset?: number } = {}): Promise<{ builds: BuildRecord[]; total: number }> {
    const r = await this.deploy.get(`/builds/${encodeURIComponent(appId)}`, { params });
    return r.data;
  }

  async listChannels(appId: string): Promise<ChannelRecord[]> {
    const r = await this.deploy.get(`/channels/${encodeURIComponent(appId)}`);
    return r.data?.channels ?? r.data ?? [];
  }

  async promoteBuild(buildId: string, channel: string): Promise<ChannelRecord> {
    const r = await this.deploy.post(`/builds/${buildId}/promote`, { channel });
    return r.data;
  }

  async listUpdates(appId: string, params: { platform?: string; runtimeVersion?: string; limit?: number; offset?: number } = {}): Promise<UpdateRecord[]> {
    const r = await this.updates.get(`/apps/${encodeURIComponent(appId)}/history`, { params });
    return r.data?.updates ?? r.data ?? [];
  }

  async uploadUpdate(opts: {
    bundlePath: string;
    appId: string;
    platform: 'ios' | 'android';
    runtimeVersion: string;
    version: string;
    message?: string;
  }): Promise<UpdateRecord> {
    const form = new FormData();
    form.append('bundle', fs.createReadStream(opts.bundlePath));
    form.append('metadata', JSON.stringify({
      appId: opts.appId,
      platform: opts.platform,
      runtimeVersion: opts.runtimeVersion,
      version: opts.version,
      message: opts.message ?? '',
    }));
    const r = await this.updates.post('/updates', form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return r.data;
  }

  async dispatchGithubWorkflow(opts: {
    owner: string;
    repo: string;
    workflowFile: string;
    ref?: string;
    inputs?: Record<string, string>;
  }): Promise<void> {
    const token = await resolveGithubToken();
    if (!token) throw new Error('GITHUB_TOKEN not configured. Set env var or run `pointer login`.');
    const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/actions/workflows/${encodeURIComponent(opts.workflowFile)}/dispatches`;
    const cfg: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    };
    await axios.post(url, { ref: opts.ref ?? 'main', inputs: opts.inputs ?? {} }, cfg);
  }

  async waitForLatestBuild(appId: string, platform: 'ios' | 'android', sinceIso: string, timeoutMs = 30 * 60 * 1000, pollMs = 15000): Promise<BuildRecord | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const { builds } = await this.listBuilds(appId, { platform, limit: 5 });
      const fresh = builds.find((b) => (b.createdAt ?? '') > sinceIso);
      if (fresh) return fresh;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return null;
  }
}
