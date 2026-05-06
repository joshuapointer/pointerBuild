import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { body, param, query as q, validationResult } from 'express-validator';
import { query } from '../db/pool.js';
import { upload as s3Upload, deleteObject, getSignedUrl } from '../storage/s3.js';
import { HttpError } from '../middleware/errorHandler.js';

export const updatesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

interface UpdateRow {
  id: string;
  app_id: string;
  platform: string;
  version: string;
  runtime_version: string;
  bundle_path: string;
  status: string;
  created_at: string;
}

interface AppRow {
  app_id: string;
}

updatesRouter.post(
  '/',
  upload.single('bundle'),
  body('appId').isString().trim().notEmpty(),
  body('platform').isIn(['ios', 'android']),
  body('version').isString().trim().notEmpty(),
  body('runtimeVersion').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));
      if (!req.file) throw new HttpError(400, 'bundle file is required');

      const { appId, platform, version, runtimeVersion } = req.body as {
        appId: string;
        platform: string;
        version: string;
        runtimeVersion: string;
      };

      const app = await query<AppRow>('SELECT app_id FROM apps WHERE app_id = $1', [appId]);
      if (!app.rows[0]) throw new HttpError(404, `App ${appId} not registered`);

      const updateId = uuidv4();
      const key = `bundles/${appId}/${platform}/${runtimeVersion}/${updateId}.zip`;
      await s3Upload(key, req.file.buffer, req.file.mimetype || 'application/zip');

      const result = await query<UpdateRow>(
        `INSERT INTO updates (id, app_id, platform, version, runtime_version, bundle_path)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [updateId, appId, platform, version, runtimeVersion, key],
      );
      const row = result.rows[0];
      res.status(201).json({
        id: row.id,
        appId: row.app_id,
        platform: row.platform,
        version: row.version,
        runtimeVersion: row.runtime_version,
        createdAt: row.created_at,
      });
    } catch (err) {
      next(err);
    }
  },
);

updatesRouter.get(
  '/:appId/:platform/:runtimeVersion',
  param('appId').isString().trim().notEmpty(),
  param('platform').isIn(['ios', 'android']),
  param('runtimeVersion').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId, platform, runtimeVersion } = req.params as {
        appId: string;
        platform: string;
        runtimeVersion: string;
      };
      const result = await query<UpdateRow>(
        `SELECT * FROM updates
         WHERE app_id = $1 AND platform = $2 AND runtime_version = $3 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [appId, platform, runtimeVersion],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'No active update found');

      const bundleUrl = await getSignedUrl(row.bundle_path, 3600);
      res.json({
        id: row.id,
        version: row.version,
        runtimeVersion: row.runtime_version,
        platform: row.platform,
        createdAt: row.created_at,
        bundleUrl,
      });
    } catch (err) {
      next(err);
    }
  },
);

updatesRouter.get(
  '/:appId/:platform/:runtimeVersion/:updateId',
  param('appId').isString().trim().notEmpty(),
  param('platform').isIn(['ios', 'android']),
  param('runtimeVersion').isString().trim().notEmpty(),
  param('updateId').isUUID(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId, platform, runtimeVersion, updateId } = req.params as {
        appId: string;
        platform: string;
        runtimeVersion: string;
        updateId: string;
      };
      const result = await query<UpdateRow>(
        `SELECT * FROM updates
         WHERE id = $1 AND app_id = $2 AND platform = $3 AND runtime_version = $4`,
        [updateId, appId, platform, runtimeVersion],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'Update not found');
      if (row.status !== 'active') throw new HttpError(410, 'Update archived');

      const url = await getSignedUrl(row.bundle_path, 3600);
      res.redirect(302, url);
    } catch (err) {
      next(err);
    }
  },
);

updatesRouter.delete(
  '/:updateId',
  param('updateId').isUUID(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { updateId } = req.params as { updateId: string };
      const result = await query<UpdateRow>(
        `UPDATE updates SET status = 'archived' WHERE id = $1 RETURNING *`,
        [updateId],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'Update not found');
      res.json({ id: row.id, status: row.status });
    } catch (err) {
      next(err);
    }
  },
);

updatesRouter.get(
  '/history/:appId',
  param('appId').isString().trim().notEmpty(),
  q('platform').optional().isIn(['ios', 'android']),
  q('runtimeVersion').optional().isString(),
  q('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  q('offset').optional().isInt({ min: 0 }).toInt(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId } = req.params as { appId: string };
      const queryParams = (req.query ?? {}) as Record<string, unknown>;
      const platform = queryParams.platform as string | undefined;
      const runtimeVersion = queryParams.runtimeVersion as string | undefined;
      const limit = (queryParams.limit as number | undefined) ?? 20;
      const offset = (queryParams.offset as number | undefined) ?? 0;

      const params: any[] = [appId];
      let where = 'app_id = $1';
      if (platform) {
        params.push(platform);
        where += ` AND platform = $${params.length}`;
      }
      if (runtimeVersion) {
        params.push(runtimeVersion);
        where += ` AND runtime_version = $${params.length}`;
      }
      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const result = await query<UpdateRow>(
        `SELECT * FROM updates WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM updates WHERE ${where}`,
        params.slice(0, params.length - 2),
      );
      res.json({
        updates: result.rows.map((r) => ({
          id: r.id,
          appId: r.app_id,
          platform: r.platform,
          version: r.version,
          runtimeVersion: r.runtime_version,
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

export { deleteObject };
