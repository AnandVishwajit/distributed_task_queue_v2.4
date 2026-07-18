const express    = require('express');
const http       = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { pool, initDb } = require('../db/index');
const { createRedisClient, QUEUES } = require('../db/redis');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(require('cors')());

const redis = createRedisClient();


const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[ws] client connected (total: ${clients.size})`);

  getStats().then(stats => safeSend(ws, { type: 'stats', data: stats }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (total: ${clients.size})`);
  });
});

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

setInterval(async () => {
  if (!clients.size) return;
  const stats = await getStats();
  broadcast({ type: 'stats', data: stats });
}, 2000);


async function getStats() {
  const [statusRows, highLen, normalLen, delayedLen, deadLen] = await Promise.all([
    pool.query(`SELECT status, COUNT(*) as count FROM jobs GROUP BY status`),
    redis.llen(QUEUES.HIGH),
    redis.llen(QUEUES.NORMAL),
    redis.zcard('queue:delayed'),
    redis.llen('queue:dead'),
  ]);

  const byStatus = {};
  statusRows.rows.forEach(r => { byStatus[r.status] = parseInt(r.count); });

  return {
    queues: { high: highLen, normal: normalLen, delayed: delayedLen, dead: deadLen },
    jobs:   byStatus,
    ts:     Date.now(),
  };
}


app.post('/jobs', async (req, res) => {
  const { type, payload = {}, tier = 'free', run_at } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });
  if (!['paid', 'free'].includes(tier)) return res.status(400).json({ error: 'tier must be paid or free' });

  const id    = uuidv4();
  const runAt = run_at ? new Date(run_at) : new Date();
  const isDelayed = runAt > new Date();

  await pool.query(
    `INSERT INTO jobs (id, type, payload, tier, status, run_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, type, payload, tier, 'pending', runAt]
  );

  if (isDelayed) {
    await redis.zadd('queue:delayed', runAt.getTime(), id);
  } else {
    const queue = tier === 'paid' ? QUEUES.HIGH : QUEUES.NORMAL;
    await redis.lpush(queue, id);
  }

  const job = { id, type, tier, status: 'pending', run_at: runAt };
  broadcast({ type: 'job_created', data: job });
  console.log(`[api] enqueued job ${id} (${type}) tier=${tier} delayed=${isDelayed}`);
  res.status(201).json(job);
});

app.get('/jobs/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});


app.get('/jobs', async (req, res) => {
  const { status, tier, limit = 50 } = req.query;
  const conditions = [], values = [];
  if (status) { conditions.push(`status = $${values.length+1}`); values.push(status); }
  if (tier)   { conditions.push(`tier = $${values.length+1}`);   values.push(tier); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const { rows } = await pool.query(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${values.length+1}`,
    [...values, limit]
  );
  res.json(rows);
});


app.get('/stats', async (req, res) => {
  res.json(await getStats());
});



async function start() {
  try { require('cors'); } catch {
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });
  }

  await initDb();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`[api] listening on http://localhost:${port}`);
    console.log(`[ws]  websocket on ws://localhost:${port}`);
  });
}

start().catch(console.error);
