import { pool } from './pool.js';

const MIGRATIONS = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `CREATE TABLE IF NOT EXISTS builds (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     app_id VARCHAR(255) REFERENCES apps(app_id),
     platform VARCHAR(10) NOT NULL,
     version VARCHAR(50) NOT NULL,
     build_number INTEGER NOT NULL,
     artifact_url VARCHAR(500) NOT NULL,
     branch VARCHAR(255),
     commit_sha VARCHAR(40),
     status VARCHAR(20) DEFAULT 'active',
     created_at TIMESTAMP DEFAULT NOW()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_builds_app_platform ON builds(app_id, platform DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_builds_created_at ON builds(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);`,
  `CREATE TABLE IF NOT EXISTS channels (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     app_id VARCHAR(255) REFERENCES apps(app_id),
     channel VARCHAR(50) NOT NULL,
     build_id UUID REFERENCES builds(id),
     created_at TIMESTAMP DEFAULT NOW()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_app_channel ON channels(app_id, channel);`,
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
