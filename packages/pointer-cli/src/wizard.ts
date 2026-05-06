#!/usr/bin/env node
/**
 * pointerBuild Interactive Setup Wizard
 * 
 * Orchestrates the full setup flow:
 * 1. Repo generation — clone/fork pointerBuild, configure git remote
 * 2. Local setup — copy .env.example, generate secrets, choose domain/DNS
 * 3. VPS provisioning — SSH into VPS, run infra/setup-vps.sh, validate docker-compose up
 * 4. GitHub Actions setup — fork/configure workflows, add secrets to GitHub repo
 * 5. First deploy — run `npx pointer init`, test deploy
 * 6. Management commands overview
 * 
 * Idempotent: re-running is safe, each step checks state before acting.
 * Supports CI/non-interactive mode via --ci flag.
 */

import * as readline from 'readline';
import * as fs from 'fs-extra';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, exec } from 'node:child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import YAML from 'yaml';
import * as crypto from 'node:crypto';
import { writeConfig } from './config.js';
import { log, fail, table } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

interface WizardConfig {
  ci: boolean;
  workDir: string;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  vpsHost?: string;
  vpsUser?: string;
  vpsPort?: number;
  domain?: string;
  email?: string;
  appId?: string;
  appName?: string;
  skipVps?: boolean;
  skipGithub?: boolean;
}

interface WizardState {
  configPath: string;
  workDir: string;
  domain: string;
  email: string;
  vpsHost: string;
  vpsUser: string;
  vpsPort: number;
  githubOwner: string;
  githubRepo: string;
  appId: string;
  appName: string;
  secrets: GeneratedSecrets;
  stepsCompleted: Set<string>;
}

interface GeneratedSecrets {
  dbPassword: string;
  s3AccessKey: string;
  s3SecretKey: string;
  pointerApiKey: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((res) => rl.question(q, (a) => res(a.trim())));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const run = (cmd: string, opts: { cwd?: string; silent?: boolean } = {}): string => {
  try {
    return execSync(cmd, { cwd: opts.cwd, encoding: 'utf-8', stdio: opts.silent ? 'pipe' : undefined }).toString().trim();
  } catch (err: any) {
    throw new Error(`Command failed: ${cmd}\n${err.stderr?.toString() ?? err.message}`);
  }
};

const runAsync = (cmd: string, opts: { cwd?: string } = {}): Promise<string> =>
  new Promise((res, rej) => {
    exec(cmd, { cwd: opts.cwd }, (err, stdout) => {
      if (err) rej(err);
      else res(stdout.trim());
    });
  });

const which = (cmd: string): boolean => {
  try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true; } catch { return false; }
};

const secret = (len = 32) => crypto.randomBytes(len).toString('hex').slice(0, len);

const bold = (s: string) => chalk.bold(s);
const green = (s: string) => chalk.green(s);
const yellow = (s: string) => chalk.yellow(s);
const cyan = (s: string) => chalk.cyan(s);
const dim = (s: string) => chalk.dim(s);
const red = (s: string) => chalk.red(s);

// ---------------------------------------------------------------------------
// Step 1: Repo Generation
// ---------------------------------------------------------------------------

async function stepRepoGen(state: WizardState, answers: WizardConfig): Promise<void> {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('Step 1:')} Repo Generation`);
  console.log(`${bold('━'.repeat(60))}\n`);

  const workDir = answers.workDir || path.join(os.homedir(), 'pointerBuild');

  // Check if already cloned
  const gitDir = path.join(workDir, '.git');
  if (fs.existsSync(gitDir)) {
    log.info(`Repo already exists at ${workDir}`);
    try {
      const remotes = run('git remote', { cwd: workDir }).trim().split('\n');
      const hasOrigin = remotes.includes('origin');
      if (hasOrigin) {
        const remoteUrl = run('git remote get-url origin', { cwd: workDir });
        log.info(`origin → ${remoteUrl}`);
        if (!remoteUrl.includes('pointerBuild')) {
          log.warn('origin does not point to pointerBuild. You may want to update it manually.');
        }
      }
    } catch {
      // ignore git errors
    }
    state.workDir = workDir;
    log.success('Skipping repo clone (already exists)');
    state.stepsCompleted.add('repo');
    return;
  }

  if (answers.ci) {
    fail('CI mode: repo not found and --ci requires existing repo. Clone manually first.');
  }

  log.info(`Cloning pointerBuild into ${workDir}...`);
  run(`git clone https://github.com/joshuapoiter/pointerBuild.git "${workDir}"`);
  state.workDir = workDir;
  state.stepsCompleted.add('repo');
  log.success('Repo cloned');
}

async function stepLocalSetup(state: WizardState, answers: WizardConfig): Promise<void> {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('Step 2:')} Local Setup — .env, secrets, domain`);
  console.log(`${bold('━'.repeat(60))}\n`);

  const workDir = state.workDir;
  const envPath = path.join(workDir, '.env');

  // Load existing .env if present
  const existingEnv: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) existingEnv[m[1]] = m[2];
    }
    log.info('.env already exists, preserving existing values');
  }

  const dbPassword = existingEnv.DB_PASSWORD || secret(24);
  const s3AccessKey = existingEnv.S3_ACCESS_KEY || secret(16);
  const s3SecretKey = existingEnv.S3_SECRET_KEY || secret(32);
  const pointerApiKey = existingEnv.POINTER_API_KEY || secret(32);

  // Collect domain/email if not provided
  let domain = answers.domain || existingEnv.POINTER_DOMAIN || '';
  let email = answers.email || existingEnv.LETSENCRYPT_EMAIL || '';

  if (answers.ci) {
    if (!domain || !email) {
      fail('CI mode requires --domain and --email flags');
    }
  } else {
    if (!domain) {
      domain = await ask(yellow('Domain for your VPS (e.g. my-vps.example.com): '));
    }
    if (!email) {
      email = await ask(yellow('Email for Let\'s Encrypt (e.g. you@example.com): '));
    }
  }

  state.domain = domain;
  state.email = email;
  state.secrets = { dbPassword, s3AccessKey, s3SecretKey, pointerApiKey };

  // Read .env.example and replace placeholders
  const examplePath = path.join(workDir, '.env.example');
  let envContent = fs.readFileSync(examplePath, 'utf-8');
  
  envContent = envContent
    .replace(/DB_PASSWORD=.*/, `DB_PASSWORD=${dbPassword}`)
    .replace(/S3_ACCESS_KEY=.*/, `S3_ACCESS_KEY=${s3AccessKey}`)
    .replace(/S3_SECRET_KEY=.*/, `S3_SECRET_KEY=${s3SecretKey}`)
    .replace(/POINTER_API_KEY=.*/, `POINTER_API_KEY=${pointerApiKey}`)
    .replace(/POINTER_DOMAIN=.*/, `POINTER_DOMAIN=${domain}`)
    .replace(/LETSENCRYPT_EMAIL=.*/, `LETSENCRYPT_EMAIL=${email}`)
    .replace(/GITHUB_TOKEN=.*/, `GITHUB_TOKEN=${answers.githubToken || '${GITHUB_TOKEN}'}`)
    .replace(/GITHUB_OWNER=.*/, `GITHUB_OWNER=${answers.githubOwner || '${GITHUB_OWNER}'}`)
    .replace(/GITHUB_REPO=.*/, `GITHUB_REPO=${answers.githubRepo || '${GITHUB_REPO}'}`);

  fs.writeFileSync(envPath, envContent, { mode: 0o600 });
  log.success(`.env written to ${envPath}`);

  state.stepsCompleted.add('local-setup');
}

async function stepVpsProvisioning(state: WizardState, answers: WizardConfig): Promise<void> {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('Step 3:')} VPS Provisioning`);
  console.log(`${bold('━'.repeat(60))}\n`);

  if (answers.skipVps) {
    log.warn('Skipping VPS provisioning (--skip-vps)');
    return;
  }

  let vpsHost = answers.vpsHost || '';
  let vpsUser = answers.vpsUser || '';
  let vpsPort = answers.vpsPort || 22;

  if (answers.ci) {
    if (!vpsHost || !vpsUser) fail('CI mode requires --vps-host and --vps-user');
  } else {
    if (!vpsHost) vpsHost = await ask(yellow('VPS hostname/IP: '));
    if (!vpsUser) vpsUser = await ask(yellow('SSH user (e.g. root): '));
  }

  state.vpsHost = vpsHost;
  state.vpsUser = vpsUser;
  state.vpsPort = vpsPort;

  const sshCmd = (cmd: string) => {
    const portArg = vpsPort !== 22 ? `-p ${vpsPort}` : '';
    return `ssh ${portArg} -o StrictHostKeyChecking=no ${vpsUser}@${vpsHost} "${cmd.replace(/"/g, '\\"')}"`;
  };

  const scp = (local: string, remote: string) => {
    const portArg = vpsPort !== 22 ? `-P ${vpsPort}` : '';
    run(`scp ${portArg} -o StrictHostKeyChecking=no "${local}" "${vpsUser}@${vpsHost}:${remote}"`);
  };

  // Check SSH connectivity
  log.info(`Testing SSH to ${vpsUser}@${vpsHost}...`);
  try {
    run(`ssh ${vpsPort !== 22 ? `-p ${vpsPort}` : ''} -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${vpsUser}@${vpsHost} "echo ok"`, { silent: true });
    log.success('SSH connection OK');
  } catch {
    log.warn('SSH connection failed. Make sure you have SSH access to your VPS.');
    if (!answers.ci) {
      const proceed = await ask(yellow('Continue anyway? (y/N): '));
      if (proceed.toLowerCase() !== 'y') process.exit(0);
    }
  }

  // Run setup-vps.sh
  log.info('Transferring and running infra/setup-vps.sh...');
  const setupScript = path.join(state.workDir, 'infra', 'setup-vps.sh');
  const tmpScript = `/tmp/setup-vps-${Date.now()}.sh`;
  
  // Copy .env and setup script to VPS
  scp(setupScript, tmpScript);
  scp(path.join(state.workDir, '.env'), '/tmp/pointer.env');

  const sshSetup = `chmod +x ${tmpScript}; ` +
    `POINTER_DOMAIN=${state.domain} REPO_URL=https://github.com/joshuapoiter/pointerBuild.git ` +
    `INSTALL_DIR=/opt/pointerBuild bash ${tmpScript} 2>&1 | head -50; ` +
    `rm -f ${tmpScript}`;

  try {
    const out = run(sshCmd(sshSetup));
    log.info('Setup script output: ' + dim(out.slice(0, 500)));
  } catch (err) {
    log.warn('Setup script had issues: ' + (err as Error).message);
  }

  // Sync .env to VPS
  log.info('Syncing .env to VPS...');
  scp(path.join(state.workDir, '.env'), '/opt/pointerBuild/.env');

  // Run docker compose up
  log.info('Starting docker compose services...');
  const dockerCmd = `cd /opt/pointerBuild && docker compose up -d --build 2>&1 | tail -20`;
  try {
    const out = run(sshCmd(dockerCmd));
    log.info(dim(out));
    log.success('docker compose up completed');
  } catch (err) {
    log.warn('docker compose up issues: ' + (err as Error).message);
  }

  // Wait for services and validate
  log.info('Waiting for services to start (15s)...');
  await sleep(15000);

  log.info('Validating services...');
  const healthCheck = 
    `curl -sf http://localhost:3001/health && echo "updates:ok" || echo "updates:fail"; ` +
    `curl -sf http://localhost:3002/health && echo "deploy:ok" || echo "deploy:fail"; ` +
    `docker compose -f /opt/pointerBuild/docker-compose.yml ps --format json 2>/dev/null | head -5 || echo "ps:fail";`;

  try {
    const health = run(sshCmd(healthCheck));
    const updates = health.includes('updates:ok') ? green('OK') : red('FAIL');
    const deploy = health.includes('deploy:ok') ? green('OK') : red('FAIL');
    log.info(`Updates server: ${updates} | Deploy server: ${deploy}`);
    if (!health.includes('updates:ok') || !health.includes('deploy:ok')) {
      log.warn('Some services may not be fully up yet. Run `pointer status` later to verify.');
    }
  } catch {
    log.warn('Could not validate services. Check manually with `docker compose ps`.');
  }

  state.stepsCompleted.add('vps');
}

async function stepGithubSetup(state: WizardState, answers: WizardConfig): Promise<void> {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('Step 4:')} GitHub Actions Setup`);
  console.log(`${bold('━'.repeat(60))}\n`);

  if (answers.skipGithub) {
    log.warn('Skipping GitHub Actions setup (--skip-github)');
    return;
  }

  const token = answers.githubToken || process.env.GITHUB_TOKEN;
  if (!token) {
    log.warn('No GitHub token found. Set GITHUB_TOKEN env var or pass --github-token.');
    log.warn('Skipping GitHub Actions setup. You can run this step manually later.');
    return;
  }

  let owner = answers.githubOwner || '';
  let repo = answers.githubRepo || '';

  if (answers.ci) {
    if (!owner || !repo) fail('CI mode requires --github-owner and --github-repo');
  } else {
    if (!owner) owner = await ask(yellow('GitHub owner (username or org): '));
    if (!repo) repo = await ask(yellow('GitHub repo name (or leave empty to fork): '));
  }

  state.githubOwner = owner;
  state.githubRepo = repo;

  const forkMode = !repo;

  if (forkMode) {
    // Fork the repo
    log.info(`Forking joshuapoiter/pointerBuild...`);
    try {
      const forkResult = run(
        `curl -s -X POST -H "Authorization: Bearer ${token}" ` +
        `-H "Accept: application/vnd.github+json" ` +
        `https://api.github.com/repos/joshuapoiter/pointerBuild/forks`,
        { silent: true }
      );
      const forkData = JSON.parse(forkResult);
      const forkFullName = forkData.full_name;
      [owner, repo] = forkFullName.split('/');
      state.githubOwner = owner;
      state.githubRepo = repo;
      log.success(`Forked to ${forkFullName}`);
    } catch (err) {
      log.warn('Fork may have failed: ' + (err as Error).message);
    }
  }

  // Copy workflow files to the repo
  log.info('Adding workflow files to GitHub repo...');
  const workflowsDir = path.join(state.workDir, '.github', 'workflows');
  
  // Read workflow files
  const iosWorkflow = fs.readFileSync(path.join(workflowsDir, 'pointer-ios.yml'), 'utf-8');
  const androidWorkflow = fs.readFileSync(path.join(workflowsDir, 'pointer-android.yml'), 'utf-8');
  const ciWorkflow = fs.readFileSync(path.join(workflowsDir, 'pointer-ci.yml'), 'utf-8');

  const uploadWorkflow = async (filename: string, content: string) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows/${filename}`;
    try {
      const getResp = run(
        `curl -s -H "Authorization: Bearer ${token}" ` +
        `-H "Accept: application/vnd.github+json" ` +
        `"${url}"`,
        { silent: true }
      );
      const existing = JSON.parse(getResp);
      const sha = existing.sha;

      const encoded = Buffer.from(content).toString('base64');
      run(
        `curl -s -X PUT -H "Authorization: Bearer ${token}" ` +
        `-H "Accept: application/vnd.github+json" ` +
        `-H "Content-Type: application/json" ` +
        `-d @- "${url}" << EOF
{"message":"Add ${filename} workflow","content":"${encoded}"${sha ? `,"sha":"${sha}"` : ''}}
EOF`
      );
      log.info(`Uploaded .github/workflows/${filename}`);
    } catch (err) {
      log.warn(`Could not upload ${filename}: ${(err as Error).message}`);
    }
  };

  try {
    await uploadWorkflow('pointer-ios.yml', iosWorkflow);
    await uploadWorkflow('pointer-android.yml', androidWorkflow);
    await uploadWorkflow('pointer-ci.yml', ciWorkflow);
    log.success('Workflow files uploaded');
  } catch (err) {
    log.warn('Could not upload workflows via API: ' + (err as Error).message);
    log.info('You may need to manually copy .github/workflows/ to your repo');
  }

  // Note: Adding secrets properly requires libsodium for XOR encryption
  // For now, we'll output instructions
  log.info('Secrets that need to be added to GitHub repo:');
  log.info(dim(`  POINTER_API_KEY=${state.secrets.pointerApiKey}`));
  log.info(dim(`  POINTER_DEPLOY_URL=https://${state.domain}:3002`));
  log.info(dim(`  POINTER_UPDATES_URL=https://${state.domain}:3001`));
  log.info(dim(`  APP_ID=${state.appId || '<your-app-id>'}`));
  log.info('Add these in GitHub repo → Settings → Secrets and variables → Actions');

  state.stepsCompleted.add('github');
}

async function stepFirstDeploy(state: WizardState, _answers: WizardConfig): Promise<void> {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('Step 5:')} First Deploy — pointer init & test`);
  console.log(`${bold('━'.repeat(60))}\n`);

  const workDir = state.workDir;

  // Check if there's an Expo app in the workDir
  const hasExpoApp = fs.existsSync(path.join(workDir, 'app.json')) || 
                     fs.existsSync(path.join(workDir, 'app.config.json'));
  
  if (hasExpoApp) {
    log.info('Detected Expo app, running pointer init...');
    // Run pointer init
    try {
      const cliPath = path.join(workDir, 'packages', 'pointer-cli', 'dist', 'index.js');
      if (fs.existsSync(cliPath)) {
        run(`node "${cliPath}" init --force`, { cwd: workDir });
        log.success('pointer init completed');
      } else {
        log.info('pointer-cli not built yet. Run `npm run build` in packages/pointer-cli first.');
      }
    } catch (err) {
      log.warn('pointer init had issues: ' + (err as Error).message);
    }
  } else {
    log.info('No Expo app detected. To complete setup:');
    log.info(`  1. cd to your Expo/React Native project`);
    log.info(`  2. Run: npx pointer init`);
    log.info(`  3. Run: npx pointer deploy --platform=ios --channel=production`);
  }

  // Write pointer.config.json at root to track config
  const configPath = path.join(workDir, 'pointer.config.json');
  const configData = {
    version: '1',
    workDir,
    domain: state.domain,
    email: state.email,
    vps: {
      host: state.vpsHost,
      user: state.vpsUser,
      port: state.vpsPort,
    },
    github: {
      owner: state.githubOwner,
      repo: state.githubRepo,
    },
    secrets: {
      // Placeholder references - actual values are in .env
      dbPassword: '${DB_PASSWORD}',
      s3AccessKey: '${S3_ACCESS_KEY}',
      s3SecretKey: '${S3_SECRET_KEY}',
      pointerApiKey: '${POINTER_API_KEY}',
    },
    stepsCompleted: Array.from(state.stepsCompleted),
    createdAt: new Date().toISOString(),
  };
  fs.writeJsonSync(configPath, configData, { spaces: 2 });
  log.success(`pointer.config.json written to ${configPath}`);

  state.stepsCompleted.add('first-deploy');
}

async function stepManagementCommands(): Promise<void> {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('Step 6:')} Management Commands`);
  console.log(`${bold('━'.repeat(60))}\n`);

  log.info('Available management commands:');
  table([
    { Command: 'pointer status', Description: 'Show connected services health' },
    { Command: 'pointer logs [service]', Description: 'View logs (updates|deploy|all)' },
    { Command: 'pointer restart [service]', Description: 'Restart services (all)' },
    { Command: 'pointer update --platform=ios --message="fix"', Description: 'Publish OTA update' },
    { Command: 'pointer deploy --platform=ios --channel=production', Description: 'Trigger iOS build + deploy' },
    { Command: 'pointer builds --app com.mycompany.myapp', Description: 'List recent builds' },
    { Command: 'pointer releases --app com.mycompany.myapp', Description: 'List release channels' },
    { Command: 'pointer promote --build BUILD_ID --channel=production', Description: 'Promote build to channel' },
  ]);

  log.info('\nVPS management (via SSH):');
  table([
    { Command: 'docker compose -f /opt/pointerBuild/docker-compose.yml logs -f', Description: 'Tail all logs' },
    { Command: 'docker compose -f /opt/pointerBuild/docker-compose.yml restart', Description: 'Restart all services' },
    { Command: 'docker compose -f /opt/pointerBuild/docker-compose.yml pull', Description: 'Pull latest images' },
  ]);
}

function generateDiscordEmbed(state: WizardState): string {
  const steps = Array.from(state.stepsCompleted);
  
  // Create a Discord embed-style output (no secrets)
  const embed = {
    title: '🎉 pointerBuild Setup Complete!',
    color: 0x00d4aa, // teal
    fields: [
      {
        name: '📦 Infrastructure',
        value: [
          `**VPS**: ${state.vpsHost || '<not configured>'} (${state.vpsUser || 'root'}@${state.vpsHost || '?'})`,
          `**Domain**: https://${state.domain || '<not configured>'}`,
          `**Updates URL**: https://${state.domain || '<domain>'}:3001`,
          `**Deploy URL**: https://${state.domain || '<domain>'}:3002`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔗 GitHub Integration',
        value: [
          `**Owner**: ${state.githubOwner || '<not configured>'}`,  
          `**Repo**: ${state.githubRepo || '<not configured>'}`,
          `**Workflows**: pointer-ios.yml, pointer-android.yml`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '✅ Completed Steps',
        value: steps.map(s => `• ${s}`).join('\n') || '• (none)',
        inline: false,
      },
      {
        name: '📋 Next Steps',
        value: [
          '1. Add GitHub Actions secrets (see .env file)',
          '2. Run `pointer init` in your Expo project',
          '3. Run `pointer deploy --platform=ios --channel=production`',
          '4. Configure DNS A record for your domain → VPS IP',
          '5. Run `certbot --nginx -d updates.<domain> -d deploy.<domain>` for TLS',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛠️ Management',
        value: '`pointer status` `pointer logs` `pointer restart` `pointer update`',
        inline: false,
      },
    ],
    footer: {
      text: 'pointerBuild — Self-hosted EAS replacement',
    },
    timestamp: new Date().toISOString(),
  };

  return JSON.stringify(embed, null, 2);
}

function printDiscordEmbed(state: WizardState): void {
  console.log(`\n${bold('━'.repeat(60))}`);
  console.log(`${cyan('📝 Discord Summary (paste into Discord):')}`);
  console.log(`${bold('━'.repeat(60))}\n`);
  
  const embed = generateDiscordEmbed(state);
  console.log('```json');
  console.log(embed);
  console.log('```\n');

  // Also save to file
  const embedPath = path.join(state.workDir, 'pointer-setup-summary.json');
  fs.writeFileSync(embedPath, embed);
  log.info(`Discord embed saved to ${embedPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runWizard(cliOpts: Partial<WizardConfig> = {}): Promise<void> {
  console.log(chalk.cyan(`
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║   🔮  pointerBuild Interactive Setup Wizard                  ║
  ║                                                              ║
  ║   Self-hosted EAS replacement for Expo apps                  ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝
  `));

  const answers: WizardConfig = {
    ci: !!(process.env.CI || cliOpts.ci || false),
    workDir: cliOpts.workDir || '',
    githubToken: cliOpts.githubToken || process.env.GITHUB_TOKEN,
    githubOwner: cliOpts.githubOwner || process.env.GITHUB_OWNER,
    githubRepo: cliOpts.githubRepo || process.env.GITHUB_REPO,
    vpsHost: cliOpts.vpsHost,
    vpsUser: cliOpts.vpsUser,
    vpsPort: cliOpts.vpsPort,
    domain: cliOpts.domain,
    email: cliOpts.email,
    appId: cliOpts.appId,
    appName: cliOpts.appName,
    skipVps: cliOpts.skipVps || false,
    skipGithub: cliOpts.skipGithub || false,
  };

  if (answers.ci) {
    console.log(dim('Running in CI/non-interactive mode\n'));
  } else {
    console.log(dim('Press Ctrl+C at any time to abort\n'));
    await sleep(500);
  }

  const state: WizardState = {
    configPath: '',
    workDir: answers.workDir || path.join(os.homedir(), 'pointerBuild'),
    domain: '',
    email: '',
    vpsHost: '',
    vpsUser: '',
    vpsPort: 22,
    githubOwner: answers.githubOwner || '',
    githubRepo: answers.githubRepo || '',
    appId: answers.appId || '',
    appName: answers.appName || '',
    secrets: { dbPassword: '', s3AccessKey: '', s3SecretKey: '', pointerApiKey: '' },
    stepsCompleted: new Set(),
  };

  // Step 1: Repo generation
  await stepRepoGen(state, answers);

  // Step 2: Local setup
  await stepLocalSetup(state, answers);

  // Step 3: VPS provisioning
  await stepVpsProvisioning(state, answers);

  // Step 4: GitHub Actions setup
  await stepGithubSetup(state, answers);

  // Step 5: First deploy
  await stepFirstDeploy(state, answers);

  // Step 6: Management commands
  await stepManagementCommands();

  // Discord embed summary
  printDiscordEmbed(state);

  console.log(bold(chalk.green(`
  ╔══════════════════════════════════════════════════════════════╗
  ║   ✅  Setup Complete!                                       ║
  ╚══════════════════════════════════════════════════════════════╝
  `)));

  rl.close();
}

// CLI entry point - parse args and run wizard
function parseArgs(): Partial<WizardConfig> {
  const args = process.argv.slice(2);
  const opts: Partial<WizardConfig> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--ci':
        opts.ci = true;
        break;
      case '--work-dir':
        opts.workDir = args[++i];
        break;
      case '--github-token':
        opts.githubToken = args[++i];
        break;
      case '--github-owner':
        opts.githubOwner = args[++i];
        break;
      case '--github-repo':
        opts.githubRepo = args[++i];
        break;
      case '--vps-host':
        opts.vpsHost = args[++i];
        break;
      case '--vps-user':
        opts.vpsUser = args[++i];
        break;
      case '--vps-port':
        opts.vpsPort = parseInt(args[++i], 10);
        break;
      case '--domain':
        opts.domain = args[++i];
        break;
      case '--email':
        opts.email = args[++i];
        break;
      case '--app-id':
        opts.appId = args[++i];
        break;
      case '--skip-vps':
        opts.skipVps = true;
        break;
      case '--skip-github':
        opts.skipGithub = true;
        break;
    }
  }

  return opts;
}

// Run if executed directly
if (process.argv[1] && !process.argv[1].includes('ts-node')) {
  runWizard(parseArgs()).catch((err) => {
    console.error(chalk.red('Wizard failed:'), err.message);
    process.exit(1);
  });
}
