export type Platform = 'ios' | 'android';

export interface PointerSdkConfig {
  apiBase: string;
  appId: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface PointerDeployConfig {
  apiBase: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface UpdateManifest {
  id: string;
  appId: string;
  platform: Platform;
  version: string;
  runtimeVersion: string;
  bundleUrl: string;
  createdAt: string;
}

export interface UpdateRecord {
  id: string;
  appId: string;
  platform: Platform;
  version: string;
  runtimeVersion: string;
  bundlePath: string;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface AppRecord {
  id: string;
  appId: string;
  name: string;
  createdAt: string;
}

export interface BuildRecord {
  id: string;
  appId: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  artifactUrl: string;
  branch?: string | null;
  commitSha?: string | null;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface ChannelRecord {
  id: string;
  appId: string;
  channel: string;
  buildId: string;
  createdAt: string;
}

export interface RegisterBuildInput {
  appId: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  artifactUrl: string;
  branch?: string;
  commitSha?: string;
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

export interface CheckResult {
  hasUpdate: boolean;
  manifest: UpdateManifest | null;
}

export class PointerError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'PointerError';
    this.status = status;
    this.body = body;
  }
}
