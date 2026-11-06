import { useEffect, useRef, useState } from 'react';

/** Delays propagating a fast-changing value (e.g. a search field) by `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
    const timer = setTimeout(() => setDebounced(latest.current), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
