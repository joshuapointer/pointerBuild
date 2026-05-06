import ora from 'ora';
import { loadConfig } from '../config.js';
import { PointerClient } from '../api/client.js';
import { log, fail } from '../utils/logger.js';

export async function runPromote(opts: { app?: string; build?: string; channel?: string }): Promise<void> {
  if (!opts.build) fail('--build <id> required');
  if (!opts.channel) fail('--channel <name> required');
  const config = await loadConfig();
  const client = await PointerClient.create(config);
  const spinner = ora(`Promoting build ${opts.build} → ${opts.channel}`).start();
  try {
    await client.promoteBuild(opts.build!, opts.channel!);
    spinner.succeed(`Build ${opts.build} now on ${opts.channel}`);
  } catch (err) {
    spinner.fail('Promotion failed');
    fail('Could not promote build', err);
  }
  void log;
}
