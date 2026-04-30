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
