const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          UUID PRIMARY KEY,
      type        TEXT NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}',
      tier        TEXT NOT NULL DEFAULT 'free',   -- 'free' or 'paid'
      status      TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
      attempts    INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      error       TEXT
    );

    CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
    CREATE INDEX IF NOT EXISTS jobs_tier_idx   ON jobs(tier);
  `);
  console.log('[db] schema ready');
}

module.exports = { pool, initDb };
