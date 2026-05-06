import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

export interface PointerStorage {
  type: 's3' | 'local';
  endpoint?: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
}

export interface PointerGithub {
  owner: string;
  repo: string;
  workflowFile?: string;
  workflowIos?: string;
  workflowAndroid?: string;
}

export interface PointerConfig {
  appId: string;
  name: string;
  apiBase?: string;
  updatesUrl: string;
  deployUrl: string;
  storage?: PointerStorage;
  github?: PointerGithub;
}

export interface Credentials {
  apiKey?: string;
  githubToken?: string;
  apiBase?: string;
}

const CONFIG_FILE = 'pointer.json';
const CRED_DIR = path.join(os.homedir(), '.pointer');
const CRED_FILE = path.join(CRED_DIR, 'credentials.json');

function expandEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] ?? '');
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v);
    return out;
  }
  return value;
}

export function findConfigPath(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

export async function loadConfig(): Promise<PointerConfig> {
  const file = findConfigPath();
  if (!file) {
    throw new Error(`No ${CONFIG_FILE} found. Run \`pointer init\` first.`);
  }
  const raw = await fs.readJson(file);
  const expanded = expandEnv(raw) as PointerConfig;
  if (!expanded.appId) throw new Error(`Missing appId in ${file}`);
  if (!expanded.updatesUrl) throw new Error(`Missing updatesUrl in ${file}`);
  if (!expanded.deployUrl) throw new Error(`Missing deployUrl in ${file}`);
  return expanded;
}

export async function tryLoadConfig(): Promise<PointerConfig | null> {
  try {
    return await loadConfig();
  } catch {
    return null;
  }
}

export async function writeConfig(config: PointerConfig, dir: string = process.cwd()): Promise<string> {
  const file = path.join(dir, CONFIG_FILE);
  await fs.writeJson(file, config, { spaces: 2 });
  return file;
}

export async function loadCredentials(): Promise<Credentials> {
  if (!(await fs.pathExists(CRED_FILE))) return {};
  return (await fs.readJson(CRED_FILE)) as Credentials;
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await fs.ensureDir(CRED_DIR);
  await fs.writeJson(CRED_FILE, creds, { spaces: 2 });
  await fs.chmod(CRED_FILE, 0o600);
}

export async function clearCredentials(): Promise<void> {
  if (await fs.pathExists(CRED_FILE)) await fs.remove(CRED_FILE);
}

export async function resolveApiKey(): Promise<string | undefined> {
  if (process.env.POINTER_API_KEY) return process.env.POINTER_API_KEY;
  const creds = await loadCredentials();
  return creds.apiKey;
}

export async function resolveGithubToken(): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const creds = await loadCredentials();
  return creds.githubToken;
}

export const CONFIG_FILE_NAME = CONFIG_FILE;
export const CREDENTIALS_PATH = CRED_FILE;
