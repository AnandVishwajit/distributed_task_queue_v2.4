#!/usr/bin/env node
"use strict";

const DEFAULT_TOTAL     = 1_000;
const DEFAULT_CONCUR    = 50;      
const DEFAULT_API       = "http://localhost:3000";
const POLL_INTERVAL_MS  = 2_000;   
const POLL_TIMEOUT_MS   = 5 * 60 * 1_000; 


const JOB_MIX = [
  { type: "send_email",      tier: "paid", weight: 30 },
  { type: "resize_image",    tier: "paid", weight: 20 },
  { type: "generate_report", tier: "paid", weight: 10 },
  { type: "send_email",      tier: "free", weight: 20 },
  { type: "resize_image",    tier: "free", weight: 10 },
  { type: "generate_report", tier: "free", weight: 10 },
];


function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    total:       parseInt(get("--jobs",        DEFAULT_TOTAL),   10),
    concurrency: parseInt(get("--concurrency", DEFAULT_CONCUR),  10),
    apiBase:     get("--api", DEFAULT_API).replace(/\/$/, ""),
  };
}

function pickJob() {
  const total  = JOB_MIX.reduce((s, j) => s + j.weight, 0);
  let   rand   = Math.random() * total;
  for (const job of JOB_MIX) {
    rand -= job.weight;
    if (rand <= 0) return job;
  }
  return JOB_MIX[JOB_MIX.length - 1];
}


function buildPayload(type) {
  switch (type) {
    case "send_email":
      return {
        to:      `user${Math.floor(Math.random() * 10_000)}@example.com`,
        subject: "Your order has shipped",
        body:    "Track your package at example.com/track",
      };
    case "resize_image":
      return {
        imageUrl: `https://cdn.example.com/uploads/${crypto.randomUUID()}.jpg`,
        width:    [320, 640, 1280][Math.floor(Math.random() * 3)],
        height:   [240, 480, 960][Math.floor(Math.random() * 3)],
        format:   "webp",
      };
    case "generate_report":
      return {
        reportType: ["weekly", "monthly", "quarterly"][Math.floor(Math.random() * 3)],
        userId:     crypto.randomUUID(),
        filters:    { minAmount: 0, maxAmount: 10_000 },
      };
    default:
      return {};
  }
}


async function enqueueJob(apiBase, job) {
  const res = await fetch(`${apiBase}/jobs`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      type:    job.type,
      payload: buildPayload(job.type),
      tier:    job.tier,
    }),
  });
  if (!res.ok) {
    throw new Error(`POST /jobs failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.id ?? data.job?.id;
}


async function pMap(items, concurrency, fn) {
  const results = [];
  let   idx     = 0;

  async function worker() {
    while (idx < items.length) {
      const i    = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}


async function fetchStats(apiBase) {
  const res = await fetch(`${apiBase}/stats`);
  if (!res.ok) throw new Error(`GET /stats failed: ${res.status}`);
  return res.json();
}


const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });


function fmtDuration(ms) {
  if (ms < 1_000)  return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1_000).toFixed(1);
  return `${m}m ${s}s`;
}


function progressBar(done, total, width = 40) {
  const pct   = done / total;
  const filled = Math.round(pct * width);
  const bar   = "█".repeat(filled) + "░".repeat(width - filled);
  return `[${bar}] ${(pct * 100).toFixed(1)}%`;
}



async function main() {
  const { total, concurrency, apiBase } = parseArgs();


  if (typeof crypto === "undefined") {
    const { webcrypto } = await import("node:crypto");
    global.crypto = webcrypto;
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║        Distributed Task Queue — Load Test           ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`  API          : ${apiBase}`);
  console.log(`  Jobs         : ${fmt(total)}`);
  console.log(`  Enqueue pool : ${concurrency} parallel requests`);
  console.log(`  Job mix      :`);
  for (const j of JOB_MIX) {
    console.log(`                 ${(j.weight).toString().padStart(3)}%  ${j.tier.padEnd(4)}  ${j.type}`);
  }
  console.log();


  console.log("── Phase 1: Enqueueing jobs ─────────────────────────────\n");


  let statsBefore;
  try {
    statsBefore = await fetchStats(apiBase);
  } catch (e) {
    console.error(`\n✗  Cannot reach API at ${apiBase}\n   Is 'npm run api' running?\n`);
    process.exit(1);
  }

  const jobs      = Array.from({ length: total }, () => pickJob());
  const enqueuedIds = [];
  let   enqueueErrors = 0;

  const enqueueStart = Date.now();

  process.stdout.write("  Progress: ");
  const TICK = Math.max(1, Math.floor(total / 50)); 

  await pMap(jobs, concurrency, async (job, i) => {
    try {
      const id = await enqueueJob(apiBase, job);
      enqueuedIds.push(id);
    } catch {
      enqueueErrors++;
    }
    if ((i + 1) % TICK === 0 || i + 1 === total) {
      process.stdout.write(`\r  Progress: ${progressBar(i + 1, total)}  ${fmt(i + 1)} / ${fmt(total)}`);
    }
  });

  const enqueueEnd      = Date.now();
  const enqueueElapsed  = enqueueEnd - enqueueStart;
  const enqueueRate     = (enqueuedIds.length / (enqueueElapsed / 1_000)).toFixed(1);

  console.log(`\n\n  ✓ Enqueued  : ${fmt(enqueuedIds.length)} jobs`);
  if (enqueueErrors) console.log(`  ✗ Errors    : ${enqueueErrors}`);
  console.log(`  Duration    : ${fmtDuration(enqueueElapsed)}`);
  console.log(`  Throughput  : ${fmt(enqueueRate)} enqueues/sec\n`);


  console.log("── Phase 2: Waiting for workers to process jobs ─────────\n");

  const processStart = Date.now();
  const deadline     = processStart + POLL_TIMEOUT_MS;

  let lastDone      = 0;
  let lastPollTime  = processStart;
  let peakRate      = 0;
  let pollCount     = 0;
  const snapshots   = []; 


  const getDone       = (s) => s?.jobs?.done       ?? s?.done       ?? 0;
  const getFailed     = (s) => s?.jobs?.failed      ?? s?.failed     ?? 0;
  const getProcessing = (s) => (s?.queues?.high ?? 0) + (s?.queues?.normal ?? 0);


  const baselineDone   = getDone(statsBefore);
  const baselineFailed = getFailed(statsBefore);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    pollCount++;

    let stats;
    try {
      stats = await fetchStats(apiBase);
    } catch {
      process.stdout.write("  [poll error, retrying]\n");
      continue;
    }

    const nowDone       = getDone(stats)       - baselineDone;
    const nowFailed     = getFailed(stats)     - baselineFailed;
    const nowProcessing = getProcessing(stats);
    const totalTerminal = nowDone + nowFailed;

    const elapsed     = Date.now() - processStart;
    const pollElapsed = Date.now() - lastPollTime;
    const deltaJobs   = totalTerminal - lastDone;
    const currentRate = (deltaJobs / (pollElapsed / 1_000)).toFixed(1);

    peakRate     = Math.max(peakRate, parseFloat(currentRate));
    lastDone     = totalTerminal;
    lastPollTime = Date.now();

    snapshots.push({ t: elapsed, done: nowDone, failed: nowFailed, processing: nowProcessing });

    process.stdout.write(
      `\r  ${progressBar(totalTerminal, enqueuedIds.length)}` +
      `  done=${fmt(nowDone)}  failed=${fmt(nowFailed)}` +
      `  active=${fmt(nowProcessing)}  ${fmtDuration(elapsed)}`
    );

    if (totalTerminal >= enqueuedIds.length) {
      process.stdout.write("\n");
      break;
    }
  }

  const processEnd     = Date.now();
  const processElapsed = processEnd - processStart;

  const finalStats       = await fetchStats(apiBase);
  const finalDone        = getDone(finalStats)   - baselineDone;
  const finalFailed      = getFailed(finalStats) - baselineFailed;
  const overallRate      = (finalDone / (processElapsed / 1_000)).toFixed(1);
  const e2eElapsed       = processEnd - enqueueStart;


  const rates = snapshots
    .map((s, i) => {
      if (i === 0) return 0;
      const dt   = s.t - snapshots[i - 1].t;
      const dd   = (s.done + s.failed) - (snapshots[i - 1].done + snapshots[i - 1].failed);
      return dt > 0 ? (dd / (dt / 1_000)) : 0;
    })
    .filter((r) => r > 0)
    .sort((a, b) => a - b);

  const p50 = rates[Math.floor(rates.length * 0.50)]?.toFixed(1) ?? "—";
  const p95 = rates[Math.floor(rates.length * 0.95)]?.toFixed(1) ?? "—";


  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║                   LOAD TEST SUMMARY                 ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log("  ┌─ Enqueue phase ──────────────────────────────────┐");
  console.log(`  │  Jobs submitted     : ${fmt(enqueuedIds.length).padEnd(28)}│`);
  console.log(`  │  Submit errors      : ${fmt(enqueueErrors).padEnd(28)}│`);
  console.log(`  │  Enqueue duration   : ${fmtDuration(enqueueElapsed).padEnd(28)}│`);
  console.log(`  │  Enqueue rate       : ${(enqueueRate + " jobs/sec").padEnd(28)}│`);
  console.log("  └──────────────────────────────────────────────────┘\n");

  console.log("  ┌─ Processing phase ───────────────────────────────┐");
  console.log(`  │  Jobs completed     : ${fmt(finalDone).padEnd(28)}│`);
  console.log(`  │  Jobs failed        : ${fmt(finalFailed).padEnd(28)}│`);
  console.log(`  │  Processing time    : ${fmtDuration(processElapsed).padEnd(28)}│`);
  console.log(`  │  Throughput (avg)   : ${(overallRate + " jobs/sec").padEnd(28)}│`);
  console.log(`  │  Throughput (peak)  : ${(peakRate.toFixed(1) + " jobs/sec").padEnd(28)}│`);
  console.log(`  │  Throughput (p50)   : ${(p50 + " jobs/sec").padEnd(28)}│`);
  console.log(`  │  Throughput (p95)   : ${(p95 + " jobs/sec").padEnd(28)}│`);
  console.log("  └──────────────────────────────────────────────────┘\n");

  console.log("  ┌─ End-to-end ─────────────────────────────────────┐");
  console.log(`  │  Total wall time    : ${fmtDuration(e2eElapsed).padEnd(28)}│`);
  console.log(`  │  e2e throughput     : ${((enqueuedIds.length / (e2eElapsed / 1_000)).toFixed(1) + " jobs/sec").padEnd(28)}│`);
  console.log("  └──────────────────────────────────────────────────┘\n");

  
  const successPct = ((finalDone / enqueuedIds.length) * 100).toFixed(1);
  console.log("  ★  Resume bullet:");
  console.log(`     "Processed ${fmt(enqueuedIds.length)} jobs in ${fmtDuration(e2eElapsed)} ` +
              `(${fmt(overallRate)} jobs/sec avg, peak ${fmt(peakRate.toFixed(1))} jobs/sec); ` +
              `${successPct}% success rate across mixed priority tiers."\n`);

  if (finalFailed > 0) {
    console.log(`  ⚠  ${fmt(finalFailed)} jobs ended in 'failed' state.`);
    console.log("     Check queue:dead in Redis — likely intentional test failures in handlers.js\n");
  }

  if (processElapsed >= POLL_TIMEOUT_MS) {
    console.log(`  ⚠  Timed out after ${fmtDuration(POLL_TIMEOUT_MS)} — some jobs may still be processing.`);
    console.log("     Increase WORKER_CONCURRENCY or run more worker processes.\n");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗  Unexpected error:", err.message);
  process.exit(1);
});
