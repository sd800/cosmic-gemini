// UI snapshots only. Product authorization and persistence stay behind Central.
export function createSettingsState() {
  let value = null;
  let generation = 0;
  let pendingWrites = 0;
  let loaded = false;
  const committedByPreference = new Map();
  return {
    get value() { return value; },
    get loaded() { return loaded; },
    async read(task) {
      if (pendingWrites) return false;
      const ticket = ++generation;
      const snapshot = await task();
      if (ticket !== generation || pendingWrites) return false;
      value = snapshot;
      loaded = true;
      return true;
    },
    async write(preference, task, toPreference = result => result) {
      const ticket = ++generation;
      pendingWrites += 1;
      try {
        const result = await task();
        if (ticket > (committedByPreference.get(preference) || 0)) {
          committedByPreference.set(preference, ticket);
          value = {
            ...value,
            preferences: { ...value?.preferences, [preference]: toPreference(result) }
          };
        }
        return result;
      } finally {
        pendingWrites -= 1;
        generation += 1;
      }
    }
  };
}
