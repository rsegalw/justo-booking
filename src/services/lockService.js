// src/services/lockService.js
/**
 * Distributed lock using Redis.
 * Falls back to in-memory lock map if Redis is unavailable (single-instance only).
 */

let redis = null;
const memoryLocks = new Map(); // fallback for dev without Redis

try {
  const Redis = require('ioredis');
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  redis.connect().catch(() => {
    console.warn('⚠️  Redis unavailable — using in-memory lock (not suitable for multi-instance)');
    redis = null;
  });
} catch {
  console.warn('⚠️  Redis not configured — using in-memory lock');
}

const TTL = parseInt(process.env.SLOT_LOCK_TTL_SEC || '120', 10);

/**
 * Attempt to acquire a lock on a slot.
 * @param {string} key  e.g. "slot:SELLER_ID:2024-03-01T14:00:00Z"
 * @returns {boolean} true if lock acquired
 */
async function acquireLock(key) {
  if (redis) {
    // SET NX EX — atomic, safe for distributed systems
    const result = await redis.set(key, '1', 'EX', TTL, 'NX');
    return result === 'OK';
  }

  // In-memory fallback
  const existing = memoryLocks.get(key);
  if (existing && existing > Date.now()) return false;
  memoryLocks.set(key, Date.now() + TTL * 1000);
  return true;
}

/**
 * Release a lock.
 * @param {string} key
 */
async function releaseLock(key) {
  if (redis) {
    await redis.del(key);
    return;
  }
  memoryLocks.delete(key);
}

/**
 * Check if a slot is currently locked.
 * @param {string} key
 */
async function isLocked(key) {
  if (redis) {
    const val = await redis.get(key);
    return val !== null;
  }
  const existing = memoryLocks.get(key);
  return existing && existing > Date.now();
}

function slotLockKey(sellerId, startUtc) {
  return `slot:${sellerId}:${startUtc}`;
}

module.exports = { acquireLock, releaseLock, isLocked, slotLockKey };
