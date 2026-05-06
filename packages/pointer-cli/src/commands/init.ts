import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'node:path';
import { PointerConfig, writeConfig, findConfigPath } from '../config.js';
import { log } from '../utils/logger.js';

export async function runInit(opts: { force?: boolean } = {}): Promise<void> {
  const existing = findConfigPath(process.cwd());
  if (existing && !opts.force) {
    log.warn(`pointer.json already exists at ${existing}. Use --force to overwrite.`);
    return;
  }

  const defaults = await readExpoDefaults();

  const answers = await inquirer.prompt([
    { name: 'appId', message: 'App ID (e.g. com.acme.myapp):', default: defaults.appId },
    { name: 'name', message: 'App name:', default: defaults.name },
    { name: 'apiBase', message: 'Pointer base URL (e.g. https://my-vps.com):', default: 'http://localhost' },
    { name: 'updatesUrl', message: 'Updates server URL:', default: (a: any) => `${a.apiBase}:3001` },
    { name: 'deployUrl', message: 'Deploy server URL:', default: (a: any) => `${a.apiBase}:3002` },
    { name: 'storageType', type: 'list', message: 'Storage backend:', choices: ['s3', 'local'], default: 's3' },
    { name: 's3Endpoint', message: 'S3/MinIO endpoint:', default: (a: any) => `${a.apiBase}:9000`, when: (a: any) => a.storageType === 's3' },
    { name: 's3Bucket', message: 'S3 bucket:', default: 'pointer-builds', when: (a: any) => a.storageType === 's3' },
    { name: 'githubOwner', message: 'GitHub owner (optional, for builds):', default: '' },
    { name: 'githubRepo', message: 'GitHub repo (optional):', default: '' },
  ]);

  const config: PointerConfig = {
    appId: answers.appId,
    name: answers.name,
    apiBase: answers.apiBase,
    updatesUrl: answers.updatesUrl,
    deployUrl: answers.deployUrl,
    storage:
      answers.storageType === 's3'
        ? {
            type: 's3',
            endpoint: answers.s3Endpoint,
            bucket: answers.s3Bucket,
            accessKey: '${S3_ACCESS_KEY}',
            secretKey: '${S3_SECRET_KEY}',
          }
        : { type: 'local' },
  };

  if (answers.githubOwner && answers.githubRepo) {
    config.github = {
      owner: answers.githubOwner,
      repo: answers.githubRepo,
      workflowIos: 'pointer-ios.yml',
      workflowAndroid: 'pointer-android.yml',
    };
  }

  const file = await writeConfig(config);
  await ensurePointerIgnore();
  log.success(`Wrote ${file}`);
  log.dim('Set POINTER_API_KEY env var or run `pointer login` to authenticate.');
}

async function readExpoDefaults(): Promise<{ appId: string; name: string }> {
  const candidates = ['app.json', 'app.config.json'];
  for (const c of candidates) {
    const p = path.join(process.cwd(), c);
    if (await fs.pathExists(p)) {
      try {
        const data = await fs.readJson(p);
        const expo = data.expo ?? data;
        const ios = expo.ios?.bundleIdentifier;
        const android = expo.android?.package;
        return { appId: ios ?? android ?? '', name: expo.name ?? '' };
      } catch {
        /* ignore */
      }
    }
  }
  return { appId: '', name: '' };
}

async function ensurePointerIgnore(): Promise<void> {
  const file = path.join(process.cwd(), '.pointerignore');
  if (await fs.pathExists(file)) return;
  await fs.writeFile(file, ['node_modules/', 'dist/', '.expo/', 'ios/', 'android/', '*.log', ''].join('\n'));
}
