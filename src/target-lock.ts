const queues = new Map<string, Promise<void>>();

export async function withTargetLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const next = previous.then(() => current, () => current);
  queues.set(key, next);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (queues.get(key) === next) queues.delete(key);
  }
}

export async function withTargetLocks<T>(keys: string[], run: () => Promise<T>): Promise<T> {
  const orderedKeys = [...new Set(keys)].sort();
  async function acquire(index: number): Promise<T> {
    const key = orderedKeys[index];
    if (!key) return run();
    return withTargetLock(key, () => acquire(index + 1));
  }
  return acquire(0);
}
