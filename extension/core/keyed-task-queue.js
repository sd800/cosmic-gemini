export function createKeyedTaskQueue() {
  const pending = new Map();

  function run(key, task) {
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    pending.set(key, current);
    return current.finally(() => {
      if (pending.get(key) === current) pending.delete(key);
    });
  }

  return Object.freeze({
    run,
    size: () => pending.size,
    drain: () => Promise.allSettled([...pending.values()])
  });
}
