import { clearCredentials } from '../config.js';
import { log } from '../utils/logger.js';

export async function runLogout(): Promise<void> {
  await clearCredentials();
  log.success('Credentials cleared.');
}
