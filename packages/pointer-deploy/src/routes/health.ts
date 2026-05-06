import { Router } from 'express';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  let db = 'unknown';
  try {
    await pool.query('SELECT 1');
    db = 'ok';
  } catch {
    db = 'error';
  }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db,
  });
});
