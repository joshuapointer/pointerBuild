import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import os from 'node:os';
import ora from 'ora';
import { loadConfig } from '../config.js';
import { PointerClient } from '../api/client.js';
import { log, fail } from '../utils/logger.js';

interface UpdateOpts {
  platform?: string;
  runtimeVersion?: string;
  message?: string;
  bundle?: string;
  version?: string;
  skipExport?: boolean;
}

export async function runUpdate(opts: UpdateOpts): Promise<void> {
  const platform = (opts.platform ?? 'all') as 'ios' | 'android' | 'all';
  if (!['ios', 'android', 'all'].includes(platform)) fail(`Invalid platform: ${platform}`);
  const runtimeVersion = opts.runtimeVersion ?? (await detectRuntimeVersion());
  if (!runtimeVersion) fail('Could not detect runtime version. Pass --runtime-version.');
  const version = opts.version ?? new Date().toISOString();

  const config = await loadConfig();
  const client = await PointerClient.create(config);

  const platforms: ('ios' | 'android')[] = platform === 'all' ? ['ios', 'android'] : [platform];

  let bundleDir: string;
  if (opts.bundle) {
    bundleDir = path.resolve(opts.bundle);
  } else if (opts.skipExport) {
    bundleDir = path.resolve('dist');
  } else {
    bundleDir = path.resolve('dist');
    await fs.remove(bundleDir);
    await runExpoExport(platform === 'all' ? 'all' : platform, bundleDir);
  }

  for (const p of platforms) {
    const zipPath = await zipDir(bundleDir, p);
    const spinner = ora(`Uploading ${p} update (${runtimeVersion})`).start();
    try {
      const result = await client.uploadUpdate({
        bundlePath: zipPath,
        appId: config.appId,
        platform: p,
        runtimeVersion: runtimeVersion!,
        version,
        message: opts.message,
      });
      spinner.succeed(`Uploaded ${p} update id=${result.id}`);
    } catch (err) {
      spinner.fail(`Upload failed for ${p}`);
      fail(`Update upload failed: ${(err as Error).message}`, err);
    } finally {
      await fs.remove(zipPath).catch(() => undefined);
    }
  }
  log.success('All updates published.');
}

async function detectRuntimeVersion(): Promise<string | null> {
  for (const f of ['app.json', 'app.config.json']) {
    const p = path.join(process.cwd(), f);
    if (await fs.pathExists(p)) {
      try {
        const data = await fs.readJson(p);
        const expo = data.expo ?? data;
        if (typeof expo.runtimeVersion === 'string') return expo.runtimeVersion;
        if (expo.runtimeVersion?.policy === 'sdkVersion' && expo.sdkVersion) return expo.sdkVersion;
        if (expo.version) return expo.version;
      } catch {
        /* ignore */
      }
    }
  }
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJson(pkgPath);
    if (pkg.version) return pkg.version;
  }
  return null;
}

function runExpoExport(platform: 'ios' | 'android' | 'all', outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['expo', 'export', '--output-dir', outDir];
    if (platform !== 'all') args.push('--platform', platform);
    log.info(`Running: npx ${args.join(' ')}`);
    const proc = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`expo export exited ${code}`))));
    proc.on('error', reject);
  });
}

async function zipDir(dir: string, platform: 'ios' | 'android'): Promise<string> {
  if (!(await fs.pathExists(dir))) throw new Error(`Bundle dir not found: ${dir}`);
  const out = path.join(os.tmpdir(), `pointer-update-${platform}-${Date.now()}.zip`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('zip', ['-r', '-q', out, '.'], { cwd: dir, stdio: 'inherit' });
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`zip exited ${code}`))));
    proc.on('error', reject);
  });
  return out;
}
