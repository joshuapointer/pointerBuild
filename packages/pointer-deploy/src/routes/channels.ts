import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { query } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';

export const channelsRouter = Router();

interface ChannelRow {
  id: string;
  app_id: string;
  channel: string;
  build_id: string;
  created_at: string;
}

interface BuildRow {
  id: string;
  app_id: string;
  platform: string;
  version: string;
  build_number: number;
  artifact_url: string;
  branch: string | null;
  commit_sha: string | null;
  status: string;
  created_at: string;
}

// GET /channels/:appId - List channels for an app
channelsRouter.get(
  '/:appId',
  param('appId').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId } = req.params as { appId: string };

      interface ChannelWithBuild extends ChannelRow {
        platform: string | null;
        version: string | null;
        build_number: number | null;
        artifact_url: string | null;
        branch: string | null;
        commit_sha: string | null;
        status: string | null;
        build_created_at: string | null;
      }

      const result = await query<ChannelWithBuild>(
        `SELECT c.*, b.platform, b.version, b.build_number, b.artifact_url, b.branch, b.commit_sha, b.status, b.created_at as build_created_at
         FROM channels c
         LEFT JOIN builds b ON c.build_id = b.id
         WHERE c.app_id = $1
         ORDER BY c.channel`,
        [appId],
      );

      res.json({
        channels: result.rows.map((r) => ({
          id: r.id,
          appId: r.app_id,
          channel: r.channel,
          buildId: r.build_id,
          build: r.build_id ? {
            id: r.build_id,
            platform: r.platform,
            version: r.version,
            buildNumber: r.build_number,
            artifactUrl: r.artifact_url,
            branch: r.branch,
            commitSha: r.commit_sha,
            status: r.status,
            createdAt: r.build_created_at,
          } : null,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /channels/:appId/:channel/latest - Get latest build on a channel
channelsRouter.get(
  '/:appId/:channel',
  param('appId').isString().trim().notEmpty(),
  param('channel').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId, channel } = req.params as { appId: string; channel: string };

      const channelResult = await query<ChannelRow>(
        `SELECT * FROM channels WHERE app_id = $1 AND channel = $2`,
        [appId, channel],
      );
      const channelRow = channelResult.rows[0];
      if (!channelRow) throw new HttpError(404, `Channel ${channel} not found for app ${appId}`);

      if (!channelRow.build_id) {
        res.json({
          channel: channelRow.channel,
          build: null,
        });
        return;
      }

      const buildResult = await query<BuildRow>(
        `SELECT * FROM builds WHERE id = $1 AND status = 'active'`,
        [channelRow.build_id],
      );
      const build = buildResult.rows[0];

      res.json({
        channel: channelRow.channel,
        build: build ? {
          id: build.id,
          appId: build.app_id,
          platform: build.platform,
          version: build.version,
          buildNumber: build.build_number,
          artifactUrl: build.artifact_url,
          branch: build.branch,
          commitSha: build.commit_sha,
          status: build.status,
          createdAt: build.created_at,
        } : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /channels - Create a release channel
channelsRouter.post(
  '/',
  body('appId').isString().trim().notEmpty().isLength({ max: 255 }),
  body('channel').isString().trim().notEmpty().isLength({ max: 50 }),
  body('buildId').isUUID(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId, channel, buildId } = req.body as {
        appId: string;
        channel: string;
        buildId: string;
      };

      // Verify build exists
      const buildResult = await query<BuildRow>(
        'SELECT * FROM builds WHERE id = $1 AND status = $2',
        [buildId, 'active'],
      );
      if (!buildResult.rows[0]) throw new HttpError(404, 'Build not found');

      // Verify build belongs to the app
      const build = buildResult.rows[0];
      if (build.app_id !== appId) throw new HttpError(400, 'Build does not belong to this app');

      const result = await query<ChannelRow>(
        `INSERT INTO channels (app_id, channel, build_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (app_id, channel) DO UPDATE SET build_id = $3, created_at = NOW()
         RETURNING *`,
        [appId, channel, buildId],
      );
      const row = result.rows[0];

      res.status(201).json({
        id: row.id,
        appId: row.app_id,
        channel: row.channel,
        buildId: row.build_id,
        createdAt: row.created_at,
      });
    } catch (err) {
      next(err);
    }
  },
);
