export function createMembersLoader({ load, onData, onError }) {
  let active = true;
  let version = 0;
  return {
    dispose() {
      active = false;
      version++;
    },
    async run(mutation) {
      if (!active) return;
      const request = ++version;
      const current = () => active && request === version;
      onError(null);
      let mutationError;
      try {
        if (mutation) await mutation();
      } catch (error) {
        mutationError = error;
      }
      if (!current()) return;
      try {
        const data = await load();
        if (current()) {
          onData(data);
          onError(mutationError ?? null);
        }
      } catch (error) {
        if (current()) onError(mutationError ?? error);
      }
    },
  };
}
