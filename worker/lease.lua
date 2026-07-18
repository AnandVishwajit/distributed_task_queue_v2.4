-- KEYS[1] = queue:high
-- KEYS[2] = queue:normal
-- KEYS[3] = queue:processing
-- ARGV[1] = worker_id  (unique string)
-- ARGV[2] = lease_ttl  

local id = redis.call('RPOPLPUSH', KEYS[1], KEYS[3])

if not id then
  id = redis.call('RPOPLPUSH', KEYS[2], KEYS[3])
end

if id then
  redis.call('SET', 'lease:' .. id, ARGV[1], 'EX', tonumber(ARGV[2]))
end

return id
