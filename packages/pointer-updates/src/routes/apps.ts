import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { query } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';

export const appsRouter = Router();

interface AppRow {
  id: string;
  app_id: string;
  name: string;
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
