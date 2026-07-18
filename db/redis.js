const Redis = require('ioredis');
require('dotenv').config();

function createRedisClient() {
  const client = new Redis(process.env.REDIS_URL);
  client.on('error', (err) => console.error('[redis] error:', err.message));
  return client;
}

// Queue names
const QUEUES = {
  HIGH:   'queue:high',    // paid users
  NORMAL: 'queue:normal',  // free users
};

module.exports = { createRedisClient, QUEUES };
