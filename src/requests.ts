// Share only requests for the same state generation. A reload started after a
// mutation must not reuse a response that was requested before the mutation.
export function sharePending<K, V>(pending: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(load);
  pending.set(key, promise);
  const clear = () => { if (pending.get(key) === promise) pending.delete(key); };
  void promise.then(clear, clear);
  return promise;
}
