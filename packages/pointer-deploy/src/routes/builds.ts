import { Router } from 'express';
import { body, param, query as q, validationResult } from 'express-validator';
import { query } from '../db/pool.js';
import { getSignedUrl, isValidUrl } from '../storage/s3.js';
import { HttpError } from '../middleware/errorHandler.js';

export const buildsRouter = Router();

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

interface AppRow {
  app_id: string;
}

// POST /builds - Register a new build artifact
buildsRouter.post(
  '/',
  body('appId').isString().trim().notEmpty().isLength({ max: 255 }),
  body('platform').isIn(['ios', 'android']),
  body('version').isString().trim().notEmpty().isLength({ max: 50 }),
  body('buildNumber').isInt({ min: 1 }).toInt(),
  body('artifactUrl').isString().trim().notEmpty().isLength({ max: 500 }),
  body('branch').optional().isString().trim().isLength({ max: 255 }),
  body('commitSha').optional().isString().trim().isLength({ max: 40 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId, platform, version, buildNumber, artifactUrl, branch, commitSha } = req.body as {
        appId: string;
        platform: string;
        version: string;
        buildNumber: number;
        artifactUrl: string;
        branch?: string;
        commitSha?: string;
      };

      // Validate artifactUrl is a valid URL
      if (!isValidUrl(artifactUrl)) {
        throw new HttpError(400, 'artifactUrl must be a valid URL');
      }

      // Check app exists (apps table is shared with pointer-updates)
      const app = await query<AppRow>('SELECT app_id FROM apps WHERE app_id = $1', [appId]);
      if (!app.rows[0]) throw new HttpError(404, `App ${appId} not registered`);

      const result = await query<BuildRow>(
        `INSERT INTO builds (app_id, platform, version, build_number, artifact_url, branch, commit_sha)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [appId, platform, version, buildNumber, artifactUrl, branch ?? null, commitSha ?? null],
      );
      const row = result.rows[0];
      res.status(201).json({
        id: row.id,
        appId: row.app_id,
        platform: row.platform,
        version: row.version,
        buildNumber: row.build_number,
        createdAt: row.created_at,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /builds/:appId - List builds for an app
buildsRouter.get(
  '/:appId',
  param('appId').isString().trim().notEmpty(),
  q('platform').optional().isIn(['ios', 'android']),
  q('branch').optional().isString().trim(),
  q('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  q('offset').optional().isInt({ min: 0 }).toInt(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId } = req.params as { appId: string };
      const queryParams = (req.query ?? {}) as Record<string, unknown>;
      const platform = queryParams.platform as string | undefined;
      const branch = queryParams.branch as string | undefined;
      const limit = (queryParams.limit as number | undefined) ?? 20;
      const offset = (queryParams.offset as number | undefined) ?? 0;

      const params: any[] = [appId];
      let where = 'app_id = $1 AND status = $2';
      const statusIdx = 2;
      params.push('active');
      
      if (platform) {
        params.push(platform);
        where += ` AND platform = $${params.length}`;
      }
      if (branch) {
        params.push(branch);
        where += ` AND branch = $${params.length}`;
      }
      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const result = await query<BuildRow>(
        `SELECT * FROM builds WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM builds WHERE app_id = $1 AND status = $2`,
        [appId, 'active'],
      );
      res.json({
        builds: result.rows.map((r) => ({
          id: r.id,
          appId: r.app_id,
          platform: r.platform,
          version: r.version,
          buildNumber: r.build_number,
          artifactUrl: r.artifact_url,
          branch: r.branch,
          commitSha: r.commit_sha,
          status: r.status,
          createdAt: r.created_at,
        })),
        total: Number(countResult.rows[0]?.count ?? 0),
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /builds/:appId/latest - Get latest build for each platform
buildsRouter.get(
  '/:appId/latest',
  param('appId').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId } = req.params as { appId: string };

      const iosResult = await query<BuildRow>(
        `SELECT * FROM builds
         WHERE app_id = $1 AND platform = 'ios' AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [appId],
      );
      const androidResult = await query<BuildRow>(
        `SELECT * FROM builds
         WHERE app_id = $1 AND platform = 'android' AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [appId],
      );

      const formatBuild = (r: BuildRow | undefined) => r ? {
        id: r.id,
        appId: r.app_id,
        platform: r.platform,
        version: r.version,
        buildNumber: r.build_number,
        artifactUrl: r.artifact_url,
        branch: r.branch,
        commitSha: r.commit_sha,
        status: r.status,
        createdAt: r.created_at,
      } : null;

      res.json({
        ios: formatBuild(iosResult.rows[0]),
        android: formatBuild(androidResult.rows[0]),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /builds/:buildId/download - Get signed download URL for build artifact
buildsRouter.get(
  '/:buildId/download',
  param('buildId').isUUID(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { buildId } = req.params as { buildId: string };

      const result = await query<BuildRow>(
        'SELECT * FROM builds WHERE id = $1 AND status = $2',
        [buildId, 'active'],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'Build not found');

      // For external URLs (artifactUrl is already a full URL), just return it
      // For S3-backed artifacts, generate a signed URL
      let url: string;
      let expiresAt: string;

      if (row.artifact_url.startsWith('s3://') || row.artifact_url.startsWith('/')) {
        // This is an S3/MinIO path, generate signed URL
        url = await getSignedUrl(row.artifact_url, 3600);
        expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      } else {
        // External URL provided directly
        url = row.artifact_url;
        expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      }

      res.json({ url, expiresAt });
    } catch (err) {
      next(err);
    }
  },
);

// POST /builds/:buildId/promote - Promote a build to a release channel
buildsRouter.post(
  '/:buildId/promote',
  param('buildId').isUUID(),
  body('channel').isIn(['production', 'staging', 'beta']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { buildId } = req.params as { buildId: string };
      const { channel } = req.body as { channel: string };

      const buildResult = await query<BuildRow>(
        'SELECT * FROM builds WHERE id = $1 AND status = $2',
        [buildId, 'active'],
      );
      const build = buildResult.rows[0];
      if (!build) throw new HttpError(404, 'Build not found');

      // Upsert channel assignment
      await query(
        `INSERT INTO channels (app_id, channel, build_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (app_id, channel) DO UPDATE SET build_id = $3, created_at = NOW()`,
        [build.app_id, channel, buildId],
      );

      res.json({
        id: build.id,
        appId: build.app_id,
        platform: build.platform,
        version: build.version,
        buildNumber: build.build_number,
        channel,
        promotedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /builds/:buildId - Remove a build
buildsRouter.delete(
  '/:buildId',
  param('buildId').isUUID(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { buildId } = req.params as { buildId: string };

      const result = await query<BuildRow>(
        `UPDATE builds SET status = 'archived' WHERE id = $1 RETURNING *`,
        [buildId],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'Build not found');

      res.json({ id: row.id, status: row.status });
    } catch (err) {
      next(err);
    }
  },
);
