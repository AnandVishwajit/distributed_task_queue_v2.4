# Task Queue — Week 1–2

A distributed task queue with priority support (paid vs free users), delayed jobs, retries with exponential backoff, and a dead letter queue.

## What's built this week

- REST API to enqueue and inspect jobs
- Worker that processes jobs concurrently
- Two-tier priority queue: `queue:high` (paid) always drains before `queue:normal` (free)
- Delayed jobs via Redis sorted set
- Exponential backoff + jitter on failure (max 5 retries)
- Dead letter queue for jobs that exhaust retries
- Postgres for job persistence

## Prerequisites

- Node.js (v18+)
- Docker + Docker Compose

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres and Redis
docker compose up -d

# 3. Copy environment file (already configured for Docker Compose)
# .env is already set up — no changes needed for local dev

# 4. Start the API (in one terminal)
npm run api

# 5. Start a worker (in another terminal)
npm run worker

# Run multiple workers for concurrency:
npm run worker   # terminal 2
npm run worker   # terminal 3
```

## API

### Enqueue a job
```bash
POST /jobs
Content-Type: application/json

{
  "type": "send_email",
  "payload": { "to": "user@example.com", "subject": "Welcome!" },
  "tier": "paid"
}
```

Fields:
- `type` — must match a handler in `worker/handlers.js`
- `payload` — any object, passed to the handler
- `tier` — `"paid"` (high priority) or `"free"` (normal priority). Default: `"free"`
- `run_at` — ISO timestamp for delayed jobs. Omit for immediate. Example: `"2024-12-01T10:00:00Z"`

### Check a job
```bash
GET /jobs/:id
```

### List jobs
```bash
GET /jobs?status=pending&tier=paid&limit=20
```

### Queue stats
```bash
GET /stats
```

## Try it

```bash
# Enqueue a paid (high priority) job
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"send_email","payload":{"to":"vip@example.com","subject":"Hello"},"tier":"paid"}'

# Enqueue a free job
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"resize_image","payload":{"file":"photo.jpg","size":800},"tier":"free"}'

# Schedule a delayed job (runs in 30 seconds)
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"generate_report\",\"payload\":{\"report_id\":\"rpt_001\"},\"tier\":\"free\",\"run_at\":\"$(date -u -v+30S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%SZ)\"}"

# Check stats
curl http://localhost:3000/stats
```

## Add your own job type

1. Add a handler function in `worker/handlers.js`:
```js
async function my_job(job) {
  // do something with job.payload
}
module.exports = { ..., my_job };
```

2. Enqueue it:
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"my_job","payload":{"key":"value"},"tier":"free"}'
```

## Project structure

```
taskqueue/
├── api/
│   └── server.js        # Express REST API
├── worker/
│   ├── worker.js        # Poll loop, retry logic, delayed promotion
│   └── handlers.js      # Job type handlers (add yours here)
├── db/
│   ├── index.js         # Postgres connection + schema
│   └── redis.js         # Redis client + queue names
├── docker-compose.yml   # Postgres + Redis
├── .env                 # Connection strings
└── package.json
```

## Coming next (Week 3)

- Job leasing with TTL via Redis Lua script — prevents duplicate processing even if a worker crashes mid-job
