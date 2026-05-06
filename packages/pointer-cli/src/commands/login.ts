import inquirer from 'inquirer';
import { loadCredentials, saveCredentials } from '../config.js';
import { log } from '../utils/logger.js';

export async function runLogin(opts: { apiKey?: string; githubToken?: string; apiBase?: string } = {}): Promise<void> {
  const existing = await loadCredentials();
  const answers = await inquirer.prompt(
    [
      !opts.apiKey && {
        name: 'apiKey',
        type: 'password',
        message: 'Pointer API key (POINTER_API_KEY):',
        mask: '*',
        default: existing.apiKey,
      },
      !opts.githubToken && {
        name: 'githubToken',
        type: 'password',
        message: 'GitHub token (for workflow dispatch, optional):',
        mask: '*',
        default: existing.githubToken,
      },
      !opts.apiBase && {
        name: 'apiBase',
        message: 'Default API base (optional):',
        default: existing.apiBase ?? '',
      },
    ].filter(Boolean) as any,
  );

  await saveCredentials({
    apiKey: opts.apiKey ?? answers.apiKey ?? existing.apiKey,
    githubToken: opts.githubToken ?? answers.githubToken ?? existing.githubToken,
    apiBase: opts.apiBase ?? answers.apiBase ?? existing.apiBase,
  });
  log.success('Credentials saved to ~/.pointer/credentials.json');
}
