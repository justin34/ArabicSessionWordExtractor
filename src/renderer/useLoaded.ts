import { useEffect, useState } from 'react';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'loaded'; value: T }
  | { state: 'failed'; message: string };

/** Loads a value when `load` changes; a load overtaken by a newer one is ignored. */
export function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let current = true;
    setLoaded({ state: 'loading' });
    load()
      .then((value) => current && setLoaded({ state: 'loaded', value }))
      .catch((err: Error) => current && setLoaded({ state: 'failed', message: err.message }));
    return () => {
      current = false;
    };
  }, [load]);
  return loaded;
}
