export interface SingleFlightGate {
  run<T>(key: string, action: () => Promise<T>): Promise<T>;
}

export function createSingleFlightGate(): SingleFlightGate {
  const active = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, action: () => Promise<T>): Promise<T> {
      const existing = active.get(key) as Promise<T> | undefined;
      if (existing) return existing;
      const request = action().finally(() => {
        if (active.get(key) === request) active.delete(key);
      });
      active.set(key, request);
      return request;
    },
  };
}
