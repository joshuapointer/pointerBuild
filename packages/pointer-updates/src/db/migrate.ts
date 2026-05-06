import { pool } from './pool.js';

const MIGRATIONS = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `CREATE TABLE IF NOT EXISTS apps (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     app_id VARCHAR(255) UNIQUE NOT NULL,
     name VARCHAR(255) NOT NULL,
     created_at TIMESTAMP DEFAULT NOW()
   );`,
  `CREATE TABLE IF NOT EXISTS updates (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     app_id VARCHAR(255) REFERENCES apps(app_id),
     platform VARCHAR(10) NOT NULL,
     version VARCHAR(50) NOT NULL,
     runtime_version VARCHAR(50) NOT NULL,
     bundle_path VARCHAR(500) NOT NULL,
     status VARCHAR(20) DEFAULT 'active',
     created_at TIMESTAMP DEFAULT NOW()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_updates_app_platform_runtime
     ON updates(app_id, platform, runtime_version DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_updates_status ON updates(status);`,
  `CREATE INDEX IF NOT EXISTS idx_updates_created_at ON updates(created_at DESC);`,
];

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of MIGRATIONS) {
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log(`Applied ${MIGRATIONS.length} migration statements.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  migrate()
    .then(() => {
      console.log('Migration complete.');
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
