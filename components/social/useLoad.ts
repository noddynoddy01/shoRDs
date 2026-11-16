import { useCallback, useEffect, useRef, useState } from "react";
import { describeSocialError } from "@/services/social/format";

/** Load something once (and again on demand) with explicit loading / error / retry state. A stale response never overwrites a newer one. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    try { const v = await fn(); if (mine === seq.current) setData(v); }
    catch (e) { if (mine === seq.current) setError(describeSocialError(e)); }
    finally { if (mine === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); return () => { seq.current += 1; }; }, [run]);
  return { data, error, loading, reload: run, setData };
}
