import ora from 'ora';
import chalk from 'chalk';
import { tryLoadConfig, resolveApiKey } from '../config.js';
import { PointerClient } from '../api/client.js';
import { log } from '../utils/logger.js';

export async function runStatus(): Promise<void> {
  const config = await tryLoadConfig();
  if (!config) {
    log.warn('No pointer.json detected. Run `pointer init`.');
    return;
  }
  log.info(`App: ${chalk.bold(config.appId)} (${config.name})`);

  const apiKey = await resolveApiKey();
  log.info(`API key: ${apiKey ? chalk.green('configured') : chalk.yellow('missing')}`);

  const client = new PointerClient(config, apiKey);

  const spinner = ora('Checking services...').start();
  const [updates, deploy] = await Promise.all([client.healthUpdates(), client.healthDeploy()]);
  spinner.stop();

  log.info(`Updates server (${config.updatesUrl}): ${updates ? chalk.green('OK') : chalk.red('DOWN')}`);
  log.info(`Deploy server  (${config.deployUrl}): ${deploy ? chalk.green('OK') : chalk.red('DOWN')}`);

  if (!updates || !deploy) process.exitCode = 1;
}
