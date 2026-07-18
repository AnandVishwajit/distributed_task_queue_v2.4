// handlers/index.js
// Add a function here for every job type you want to support.
// Each handler receives the job row from Postgres and should return a resolved
// promise on success, or throw an error on failure.

async function send_email(job) {
  // Simulate sending an email
  console.log(`[handler] send_email → to: ${job.payload.to}, subject: ${job.payload.subject}`);
  await sleep(200); // pretend it takes 200ms
}

async function resize_image(job) {
  console.log(`[handler] resize_image → file: ${job.payload.file}, size: ${job.payload.size}`);
  await sleep(500);
}

async function generate_report(job) {
  console.log(`[handler] generate_report → report_id: ${job.payload.report_id}`);
  await sleep(1000);
  // Uncomment to test retry behaviour:
  // throw new Error('report service unavailable');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  send_email,
  resize_image,
  generate_report,
};
