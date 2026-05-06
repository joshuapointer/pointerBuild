import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../config.js';
import { PointerClient, BuildRecord } from '../api/client.js';
import { log, fail } from '../utils/logger.js';

interface DeployOpts {
  platform?: string;
  channel?: string;
  message?: string;
  runtimeVersion?: string;
  ref?: string;
  wait?: boolean;
  timeout?: string;
}

export async function runDeploy(opts: DeployOpts): Promise<void> {
  const platform = (opts.platform ?? 'all') as 'ios' | 'android' | 'all';
  if (!['ios', 'android', 'all'].includes(platform)) fail(`Invalid platform: ${platform}`);

  const config = await loadConfig();
  if (!config.github?.owner || !config.github?.repo) {
    fail('pointer.json missing github.owner/github.repo. Re-run `pointer init`.');
  }

  const client = await PointerClient.create(config);
  const platforms: ('ios' | 'android')[] = platform === 'all' ? ['ios', 'android'] : [platform];
  const since = new Date().toISOString();
  const ref = opts.ref ?? 'main';
  const timeoutMs = (opts.timeout ? Number(opts.timeout) : 30) * 60 * 1000;

  for (const p of platforms) {
    const workflow = workflowFor(config.github!, p);
    const spinner = ora(`Dispatching ${p} workflow (${workflow}) on ${ref}`).start();
    try {
      await client.dispatchGithubWorkflow({
        owner: config.github!.owner,
        repo: config.github!.repo,
        workflowFile: workflow,
        ref,
        inputs: {
          platform: p,
          runtimeVersion: opts.runtimeVersion ?? '',
          channel: opts.channel ?? '',
          message: opts.message ?? '',
        },
      });
      spinner.succeed(`Dispatched ${p} workflow`);
    } catch (err) {
      spinner.fail(`Dispatch failed for ${p}`);
      fail(`GitHub workflow dispatch failed: ${(err as Error).message}`, err);
    }
  }

  if (opts.wait === false) {
    log.info('Skipping wait (--no-wait). Use `pointer builds` to check progress.');
    return;
  }

  const built: BuildRecord[] = [];
  for (const p of platforms) {
    const spinner = ora(`Waiting for ${p} build artifact (timeout ${Math.round(timeoutMs / 60000)}m)`).start();
    const build = await client.waitForLatestBuild(config.appId, p, since, timeoutMs);
    if (!build) {
      spinner.fail(`Timed out waiting for ${p} build`);
      continue;
    }
    spinner.succeed(`${p} build ready: ${chalk.bold(build.id)} v${build.version}#${build.buildNumber}`);
    built.push(build);
  }

  if (built.length === 0) fail('No builds completed before timeout.');

  if (opts.channel) {
    for (const b of built) {
      const spinner = ora(`Promoting ${b.platform} build ${b.id.slice(0, 8)} → ${opts.channel}`).start();
      try {
        await client.promoteBuild(b.id, opts.channel);
        spinner.succeed(`${b.platform} on ${opts.channel}`);
      } catch (err) {
        spinner.fail(`Promotion failed for ${b.platform}`);
        log.error(`Could not promote: ${(err as Error).message}`);
      }
    }
  }

  log.success('Deploy complete.');
}

function workflowFor(gh: { workflowFile?: string; workflowIos?: string; workflowAndroid?: string }, platform: 'ios' | 'android'): string {
  if (platform === 'ios' && gh.workflowIos) return gh.workflowIos;
  if (platform === 'android' && gh.workflowAndroid) return gh.workflowAndroid;
  if (gh.workflowFile) return gh.workflowFile;
  return platform === 'ios' ? 'pointer-ios.yml' : 'pointer-android.yml';
}
