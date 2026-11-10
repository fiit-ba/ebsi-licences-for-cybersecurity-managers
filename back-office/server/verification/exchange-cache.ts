import { createClient } from 'redis';

/** TTL cache operations, including atomic distributed poll locks. */
export interface ExchangeCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, seconds: number): Promise<void>;
  add(key: string, value: string, seconds: number): Promise<boolean>;
  remove(key: string): Promise<void>;
  release(key: string, token: string): Promise<void>;
}

/**
 * Provide a process-local cache when Redis is not configured.
 * @returns TTL operations with atomic admission within this process only.
 * @remarks Multiple processes require the PLR_REDIS_CACHE_URL setting.
 */
export function memoryExchangeCache(): ExchangeCache {
  const entries = new Map<string, { value: string; until: number }>();
  /**
   * Remove expired entries, including unused ephemeral exchange keys.
   * @returns No return value.
   */
  function purge() {
    for (const [key, entry] of entries) if (entry.until <= Date.now()) entries.delete(key);
  }
  setInterval(purge, 1000).unref();
  return {
    get: async (key) => {
      purge();
      return entries.get(key)?.value ?? null;
    },
    set: async (key, value, seconds) => {
      entries.set(key, { value, until: Date.now() + seconds * 1000 });
    },
    /**
     * Admit exactly one local poll owner before the lock expires.
     * @param key - Lock identifier.
     * @param value - Unique owner token.
     * @param seconds - Lock lifetime.
     * @returns Whether the lock was acquired.
     */
    add: async (key, value, seconds) => {
      purge();
      if (entries.has(key)) return false;
      entries.set(key, { value, until: Date.now() + seconds * 1000 });
      return true;
    },
    remove: async (key) => {
      entries.delete(key);
    },
    release: async (key, token) => {
      if (entries.get(key)?.value === token) entries.delete(key);
    },
  };
}

/**
 * Connect the holder-exchange cache without storing ephemeral keys in PostgreSQL.
 * @param url - Existing installation's Redis URL.
 * @returns Shared TTL operations and graceful connection shutdown.
 * @throws Redis connection/command errors.
 * @remarks Redis persistence applies to the shared instance, including expiring cache data. Raw keys and tokens are never logged.
 */
export async function redisExchangeCache(url: string) {
  const client = createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false } });
  client.on('error', () => {
    /* Command callers receive cache unavailability without sensitive material. */
  });
  await client.connect();
  const cache: ExchangeCache = {
    get: async (key) => {
      const value = await client.get(key);
      return value === null ? null : String(value);
    },
    /**
     * Store transient state for a bounded lifetime.
     * @param key - Namespaced exchange identifier.
     * @param value - Serialized transient state.
     * @param seconds - Cache lifetime.
     * @returns Completion after Redis accepts the write.
     * @throws Redis command errors.
     */
    async set(key, value, seconds) {
      await client.set(key, value, { EX: seconds });
    },
    add: async (key, value, seconds) =>
      (await client.set(key, value, { EX: seconds, NX: true })) === 'OK',
    /**
     * Remove completed or abandoned transient state.
     * @param key - Namespaced exchange identifier.
     * @returns Completion after deletion.
     * @throws Redis command errors.
     */
    async remove(key) {
      await client.del(key);
    },
    /**
     * Release only the lock still owned by this poll.
     * @param key - Poll lock key.
     * @param token - Unique current owner token.
     * @returns Completion without deleting a successor's lock.
     * @throws Redis command errors.
     */
    async release(key, token) {
      await client.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        { keys: [key], arguments: [token] },
      );
    },
  };
  return { cache, close: () => client.quit() };
}

/**
 * Defer the shared cache connection so unrelated lifecycle admission survives Redis outages.
 * @param url - Existing configured Redis cache URL.
 * @returns Cache operations and cleanup, with connection retry after dependency failure.
 * @remarks Configured Redis never falls back to a process-local cache. Failed exchange calls
 * still fail; this only removes the cache dependency from unrelated API startup.
 */
export function lazyRedisExchangeCache(url: string) {
  let connection: ReturnType<typeof redisExchangeCache> | undefined;
  /**
   * Execute a cache command using a lazily connected shared Redis client.
   * @param work - TTL-cache operation.
   * @returns The operation result.
   * @throws Redis connection or command errors.
   */
  async function run<T>(work: (cache: ExchangeCache) => Promise<T>): Promise<T> {
    connection ??= redisExchangeCache(url);
    const current = connection;
    try {
      return await work((await current).cache);
    } catch (error) {
      if (connection === current) connection = undefined;
      try {
        await (await current).close();
      } catch {
        /* The failed connection may already be closed. */
      }
      throw error;
    }
  }
  const cache: ExchangeCache = {
    get: (key) => run((cache) => cache.get(key)),
    set: (key, value, seconds) => run((cache) => cache.set(key, value, seconds)),
    add: (key, value, seconds) => run((cache) => cache.add(key, value, seconds)),
    remove: (key) => run((cache) => cache.remove(key)),
    release: (key, token) => run((cache) => cache.release(key, token)),
  };
  return {
    cache,
    /**
     * Close only a cache connection created by this runtime.
     * @returns Completion after closing a connected client, or no operation before first use.
     */
    async close() {
      const current = connection;
      connection = undefined;
      if (current) {
        try {
          await (await current).close();
        } catch {
          /* Closing unavailable Redis is best effort. */
        }
      }
    },
  };
}
