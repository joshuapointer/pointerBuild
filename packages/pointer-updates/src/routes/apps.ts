import { Router } from 'express';
import { body, param, query as q, validationResult } from 'express-validator';
import { query } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';

export const appsRouter = Router();

interface AppRow {
  id: string;
  app_id: string;
  name: string;
  created_at: string;
}

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

appsRouter.post(
  '/',
  body('appId').isString().trim().notEmpty().isLength({ max: 255 }),
  body('name').isString().trim().notEmpty().isLength({ max: 255 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId, name } = req.body as { appId: string; name: string };
      const existing = await query<AppRow>('SELECT * FROM apps WHERE app_id = $1', [appId]);
      if (existing.rows[0]) {
        throw new HttpError(409, `App ${appId} already registered`);
      }

      const result = await query<AppRow>(
        'INSERT INTO apps (app_id, name) VALUES ($1, $2) RETURNING *',
        [appId, name],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

appsRouter.get('/', async (_req, res, next) => {
  try {
    const result = await query<AppRow>('SELECT * FROM apps ORDER BY created_at DESC');
    res.json({ apps: result.rows, total: result.rows.length });
  } catch (err) {
    next(err);
  }
});

appsRouter.get(
  '/:appId',
  param('appId').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, errors.array().map((e) => e.msg).join('; '));

      const { appId } = req.params as { appId: string };
      const result = await query<AppRow>('SELECT * FROM apps WHERE app_id = $1', [appId]);
      if (!result.rows[0]) throw new HttpError(404, `App ${appId} not found`);
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

appsRouter.get(
  '/:appId/history',
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
