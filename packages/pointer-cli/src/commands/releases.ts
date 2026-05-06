import { loadConfig } from '../config.js';
import { PointerClient } from '../api/client.js';
import { log, table } from '../utils/logger.js';

export async function runReleases(opts: { app?: string }): Promise<void> {
  const config = await loadConfig();
  const appId = opts.app ?? config.appId;
  const client = await PointerClient.create(config);
  const channels = await client.listChannels(appId);
  if (!channels || channels.length === 0) {
    log.info(`No channels for ${appId}`);
    return;
  }
  table(
    channels.map((c) => ({
      channel: c.channel,
      buildId: c.buildId?.slice(0, 8) ?? '',
      version: c.build?.version ?? '',
      platform: c.build?.platform ?? '',
      updated: c.createdAt ?? '',
    })),
  );
}
