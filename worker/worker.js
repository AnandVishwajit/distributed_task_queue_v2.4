const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { pool, initDb } = require('../db/index');
const { createRedisClient, QUEUES } = require('../db/redis');
const handlers = require('./handlers');
require('dotenv').config();


const CONCURRENCY   = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
const POLL_INTERVAL = 500;
const LEASE_TTL     = 30;
const REAP_INTERVAL = 10000;


const sharedRedis = createRedisClient();

const luaScript = fs.readFileSync(path.join(__dirname, 'lease.lua'), 'utf8');

function makeRedisClient() {
  const client = createRedisClient();
  client.defineCommand('acquireLease', { numberOfKeys: 3, lua: luaScript });
  return client;
}


function backoffMs(attempt) {
  const base   = Math.pow(2, attempt) * 1000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function promoteDelayedJobs() {
  const now = Date.now();
  const ids  = await sharedRedis.zrangebyscore('queue:delayed', '-inf', now);
  if (!ids.length) return;

  for (const id of ids) {
    const { rows } = await pool.query('SELECT tier FROM jobs WHERE id = $1', [id]);
    if (!rows.length) { await sharedRedis.zrem('queue:delayed', id); continue; }

    const queue = rows[0].tier === 'paid' ? QUEUES.HIGH : QUEUES.NORMAL;
    await sharedRedis.zrem('queue:delayed', id);
    await sharedRedis.lpush(queue, id);
    console.log(`[promoter] delayed job ${id} → ${queue}`);
  }
}


async function reapExpiredLeases() {
  const ids = await sharedRedis.lrange('queue:processing', 0, -1);
  if (!ids.length) return;

  for (const id of ids) {
    const lease = await sharedRedis.get(`lease:${id}`);
    if (lease) continue;

    console.warn(`[reaper] lease expired for job ${id} — re-queuing`);
    const { rows } = await pool.query('SELECT tier, status FROM jobs WHERE id = $1', [id]);

    if (!rows.length) {
      await sharedRedis.lrem('queue:processing', 1, id);
      continue;
    }
    if (rows[0].status === 'processing') {
      const queue = rows[0].tier === 'paid' ? QUEUES.HIGH : QUEUES.NORMAL;
      await sharedRedis.lrem('queue:processing', 1, id);
      await sharedRedis.lpush(queue, id);
      await pool.query(
        `UPDATE jobs SET status = 'pending', updated_at = NOW() WHERE id = $1`, [id]
      );
    } else {
      await sharedRedis.lrem('queue:processing', 1, id);
    }
  }
}

function startLeaseRenewal(redis, id, workerId) {
  return setInterval(async () => {
    await redis.set(`lease:${id}`, workerId, 'EX', LEASE_TTL);
  }, (LEASE_TTL / 2) * 1000);
}

async function processJob(redis, workerId, id) {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
  if (!rows.length) {
    await redis.lrem('queue:processing', 1, id);
    await redis.del(`lease:${id}`);
    return;
  }
  const job = rows[0];

  await pool.query(
    `UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     WHERE id = $1`, [id]
  );
  console.log(`[${workerId}] processing ${id} (${job.type}) attempt ${job.attempts + 1}`);

  const renewal = startLeaseRenewal(redis, id, workerId);

  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`no handler for job type "${job.type}"`);
    await handler(job);

    clearInterval(renewal);
    await redis.del(`lease:${id}`);
    await redis.lrem('queue:processing', 1, id);
    await pool.query(
      `UPDATE jobs SET status = 'done', updated_at = NOW() WHERE id = $1`, [id]
    );
    console.log(`[${workerId}] ✓ done ${id}`);

  } catch (err) {
    clearInterval(renewal);
    await redis.del(`lease:${id}`);
    await redis.lrem('queue:processing', 1, id);
    console.error(`[${workerId}] ✗ failed ${id}:`, err.message);

    const nextAttempt = job.attempts + 1;

    if (nextAttempt >= job.max_attempts) {
      await pool.query(
        `UPDATE jobs SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
        [id, err.message]
      );
      await sharedRedis.lpush('queue:dead', id);
      console.warn(`[${workerId}] job ${id} → dead letter queue`);
    } else {
      const delay   = backoffMs(nextAttempt);
      const retryAt = Date.now() + delay;
      await pool.query(
        `UPDATE jobs SET status = 'pending', error = $2, updated_at = NOW() WHERE id = $1`,
        [id, err.message]
      );
      await sharedRedis.zadd('queue:delayed', retryAt, id);
      console.log(`[${workerId}] retrying ${id} in ${delay}ms (attempt ${nextAttempt}/${job.max_attempts})`);
    }
  }
}


async function workerLoop(index) {
  const workerId = `worker-${index}:${uuidv4().slice(0, 8)}`;
  const redis    = makeRedisClient();

  console.log(`[worker] loop ${index} started — id: ${workerId}`);

  while (true) {
    try {
      const id = await redis.acquireLease(
        QUEUES.HIGH, QUEUES.NORMAL, 'queue:processing',
        workerId, LEASE_TTL
      );

      if (id) {
        await processJob(redis, workerId, id);
      } else {
        await sleep(POLL_INTERVAL);
      }
    } catch (err) {
      console.error(`[${workerId}] loop error:`, err.message);
      await sleep(POLL_INTERVAL);
    }
  }
}

async function start() {
  await initDb();

  console.log(`[worker] starting ${CONCURRENCY} concurrent loops`);


  setInterval(promoteDelayedJobs, 1000);
  setInterval(reapExpiredLeases,  REAP_INTERVAL);


  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => workerLoop(i + 1))
  );
}

start().catch(console.error);
