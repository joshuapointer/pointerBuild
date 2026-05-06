#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import updateNotifier from 'update-notifier';
import { createRequire } from 'node:module';
import { runInit } from './commands/init.js';
import { runDeploy } from './commands/deploy.js';
import { runUpdate } from './commands/update.js';
import { runBuilds } from './commands/builds.js';
import { runReleases } from './commands/releases.js';
import { runPromote } from './commands/promote.js';
import { runStatus } from './commands/status.js';
import { runLogin } from './commands/login.js';
import { runLogout } from './commands/logout.js';
import { runWizard } from './wizard.js';
import { fail } from './utils/logger.js';

dotenv.config();

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

try {
  updateNotifier({ pkg }).notify({ defer: false });
} catch {
  /* ignore */
}

const program = new Command();
program
  .name('pointer')
  .description('Self-hosted EAS replacement CLI')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize pointer.json in current directory')
  .option('-f, --force', 'overwrite existing config')
  .action(wrap(runInit));

program
  .command('deploy')
  .description('Trigger GitHub Actions builds, wait for artifacts, optionally promote')
  .option('--platform <ios|android|all>', 'target platform', 'all')
  .option('--channel <name>', 'promote to channel after build (e.g. production)')
  .option('--message <text>', 'commit/release message')
  .option('--runtime-version <ver>', 'runtime version')
  .option('--ref <ref>', 'git ref for workflow dispatch', 'main')
  .option('--no-wait', 'do not wait for build completion')
  .option('--timeout <minutes>', 'wait timeout in minutes', '30')
  .action(wrap(runDeploy));

program
  .command('update')
  .description('Run expo export and publish OTA update')
  .option('--platform <ios|android|all>', 'target platform', 'all')
  .option('--runtime-version <ver>', 'runtime version (auto-detected if omitted)')
  .option('--message <text>', 'release message')
  .option('--bundle <dir>', 'pre-built export dir (skip expo export)')
  .option('--version <version>', 'version label (default ISO timestamp)')
  .option('--skip-export', 'skip running expo export')
  .action(wrap(runUpdate));

program
  .command('builds')
  .description('List recent builds for an app')
  .option('--app <appId>', 'app id (defaults to pointer.json)')
  .option('--platform <ios|android>', 'filter by platform')
  .option('--branch <branch>', 'filter by branch')
  .option('--limit <n>', 'max rows', '20')
  .action(wrap(runBuilds));

program
  .command('releases')
  .description('List release channels and latest builds')
  .option('--app <appId>', 'app id (defaults to pointer.json)')
  .action(wrap(runReleases));

program
  .command('promote')
  .description('Promote a build to a release channel')
  .option('--app <appId>', 'app id (defaults to pointer.json)')
  .requiredOption('--build <id>', 'build id')
  .requiredOption('--channel <name>', 'channel name')
  .action(wrap(runPromote));

program
  .command('status')
  .description('Show connected services health')
  .action(wrap(runStatus));

program
  .command('login')
  .description('Store credentials in ~/.pointer/credentials.json')
  .option('--api-key <key>', 'pointer API key')
  .option('--github-token <token>', 'GitHub token')
  .option('--api-base <url>', 'default API base URL')
  .action(wrap(runLogin));

program
  .command('logout')
  .description('Clear stored credentials')
  .action(wrap(runLogout));

program
  .command('wizard')
  .description('Interactive setup wizard for pointerBuild')
  .option('--ci', 'Run in non-interactive/CI mode')
  .option('--work-dir <path>', 'Working directory for pointerBuild')
  .option('--github-token <token>', 'GitHub token for API access')
  .option('--github-owner <owner>', 'GitHub owner/org')
  .option('--github-repo <repo>', 'GitHub repository name')
  .option('--vps-host <host>', 'VPS hostname or IP')
  .option('--vps-user <user>', 'SSH user for VPS')
  .option('--vps-port <port>', 'SSH port', '22')
  .option('--domain <domain>', 'Domain for the VPS')
  .option('--email <email>', 'Email for Let\'s Encrypt')
  .option('--app-id <id>', 'App ID')
  .option('--skip-vps', 'Skip VPS provisioning step')
  .option('--skip-github', 'Skip GitHub Actions setup')
  .action(wrap(runWizard));

program.parseAsync(process.argv).catch((err) => fail((err as Error).message ?? 'Command failed', err));

function wrap<T extends (...args: any[]) => Promise<void> | void>(fn: T) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      fail((err as Error).message ?? 'Command failed', err);
    }
  };
}
