-- lease.lua
-- Atomically dequeue a job and set a lease on it in one Redis round trip.
--
-- How it works:
--   1. Pop a job id from queue:high (paid). If empty, pop from queue:normal (free).
--   2. If we got an id, set lease:{id} = worker_id with a TTL of LEASE_TTL seconds.
--   3. Push the id onto queue:processing so we can track in-flight jobs.
--   4. Return the id, or nil if both queues were empty.
--
-- Because this runs inside Redis as a single Lua script, it is atomic —
-- no other worker can pop the same id between steps 1 and 2.
-- This is the guarantee that prevents duplicate processing.
--
-- KEYS[1] = queue:high
-- KEYS[2] = queue:normal
-- KEYS[3] = queue:processing
-- ARGV[1] = worker_id  (unique string per worker process)
-- ARGV[2] = lease_ttl  (seconds, e.g. 30)

local id = redis.call('RPOPLPUSH', KEYS[1], KEYS[3])

if not id then
  id = redis.call('RPOPLPUSH', KEYS[2], KEYS[3])
end

if id then
  redis.call('SET', 'lease:' .. id, ARGV[1], 'EX', tonumber(ARGV[2]))
end

return id
