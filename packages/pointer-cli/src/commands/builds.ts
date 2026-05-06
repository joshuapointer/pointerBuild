import { loadConfig } from '../config.js';
import { PointerClient } from '../api/client.js';
import { log, table } from '../utils/logger.js';

export async function runBuilds(opts: { app?: string; platform?: string; branch?: string; limit?: string }): Promise<void> {
  const config = await loadConfig();
  const appId = opts.app ?? config.appId;
  const client = await PointerClient.create(config);
  const limit = opts.limit ? Number(opts.limit) : 20;
  const { builds, total } = await client.listBuilds(appId, {
    platform: opts.platform,
    branch: opts.branch,
    limit,
  });
  if (builds.length === 0) {
    log.info(`No builds for ${appId}`);
    return;
  }
  log.info(`${builds.length} of ${total} builds for ${appId}`);
  table(
    builds.map((b) => ({
      id: b.id.slice(0, 8),
      platform: b.platform,
      version: b.version,
      build: b.buildNumber,
      branch: b.branch ?? '',
      commit: (b.commitSha ?? '').slice(0, 7),
      created: b.createdAt ?? '',
    })),
  );
}
