import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health.js';
import { appsRouter } from './routes/apps.js';
import { updatesRouter } from './routes/updates.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { migrate } from './db/migrate.js';
import { ensureBucket } from './storage/s3.js';
import { pool } from './db/pool.js';

const PORT = Number(process.env.PORT ?? 3001);

export function createApp(): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/', healthRouter);
  app.use('/apps', appsRouter);
  app.use('/updates', updatesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function main(): Promise<void> {
  if (process.env.AUTO_MIGRATE !== 'false') {
    try {
      await migrate();
    } catch (err) {
      console.error('Auto-migrate failed (continuing):', err);
    }
  }
  if (process.env.AUTO_ENSURE_BUCKET !== 'false') {
    try {
      await ensureBucket();
    } catch (err) {
      console.warn('ensureBucket failed (continuing):', err);
    }
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`pointer-updates listening on :${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
