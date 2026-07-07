import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** True while a background revalidation is in flight (data already shown). */
  isValidating: boolean;
}

/**
 * In-memory cache shared across all useFetch callers, keyed by path.
 * Lets us show stale data instantly on route re-entry while revalidating.
 */
const memCache = new Map<string, unknown>();

/**
 * LocalStorage-backed persistent cache.
 * Keyed by path, stores { data, ts } so we can check TTL.
 */
const LS_PREFIX = "dotnify:cache:";

function lsGet<T>(path: string, ttlSec: number): T | undefined {
  try {
    const raw = localStorage.getItem(LS_PREFIX + path);
    if (!raw) return undefined;
    const { data, ts } = JSON.parse(raw) as { data: unknown; ts: number };
    if (Date.now() - ts > ttlSec * 1000) return undefined; // expired
    return data as T;
  } catch {
    return undefined;
  }
}

function lsSet(path: string, data: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + path, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

function lsDel(path: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + path);
  } catch {
    // ignore
  }
}

/**
 * Generic GET hook with stale-while-revalidate semantics.
 *
 * - First mount with fresh localStorage cache: shows cached data instantly,
 *   then revalidates in the background (so volatile fields like status stay fresh).
 * - First mount without cache: shows loading spinner, fetches from network.
 * - Re-mount with the same path: instantly shows cached data, revalidates in background.
 * - `refetch()`: **always** hits the network, bypassing localStorage cache.
 * - `cacheTtl`: if set (seconds), persists data to localStorage so the next
 *   session shows data instantly instead of a loading spinner.
 *
 * Pass `null` or `""` as `path` to skip fetching (e.g. until a param is known).
 */
export function useFetch<T>(path: string | null, opts: { cacheTtl?: number; deps?: unknown[] } = {}) {
  const { cacheTtl = 0, deps = [] } = opts;
  const active = path && path.length > 0;

  const [state, setState] = useState<State<T>>(() => {
    if (!active) return { data: null, loading: false, error: null, isValidating: false };
    // Check persistent cache first
    if (cacheTtl > 0) {
      const lsData = lsGet<T>(path, cacheTtl);
      if (lsData !== undefined) {
        memCache.set(path, lsData);
        // Show cached data but mark as revalidating so status etc. get refreshed
        return { data: lsData, loading: false, error: null, isValidating: true };
      }
    }
    // Then in-memory cache
    const cached = memCache.get(path) as T | undefined;
    if (cached !== undefined) {
      return { data: cached, loading: false, error: null, isValidating: true };
    }
    return { data: null, loading: true, error: null, isValidating: false };
  });
  const reqIdRef = useRef(0);

  /** Fetch from network. If force=true, skip localStorage cache check. */
  async function doFetch(force: boolean) {
    if (!active) {
      setState({ data: null, loading: false, error: null, isValidating: false });
      return;
    }

    // If not forced and persistent cache is still fresh, serve it instantly
    // but still revalidate in the background (so status stays fresh).
    if (!force && cacheTtl > 0) {
      const lsData = lsGet<T>(path, cacheTtl);
      if (lsData !== undefined) {
        memCache.set(path, lsData);
        setState({ data: lsData, loading: false, error: null, isValidating: true });
        // Fall through to network fetch below — don't return
      }
    }

    const reqId = ++reqIdRef.current;
    // If we have cached data, don't flip to loading (keep showing stale data).
    const hasCache = memCache.has(path);
    setState((s) => ({
      ...s,
      loading: !hasCache,
      error: null,
      isValidating: true,
    }));
    try {
      const data = await apiFetch<T>(path, { allow401: true });
      if (reqId === reqIdRef.current) {
        memCache.set(path, data);
        if (cacheTtl > 0) lsSet(path, data);
        setState({ data, loading: false, error: null, isValidating: false });
      }
    } catch (e) {
      if (reqId === reqIdRef.current) {
        const msg = e instanceof ApiError ? e.message : "Failed to load";
        setState((s) => ({ ...s, loading: false, error: msg, isValidating: false }));
      }
    }
  }

  /** Auto-fetch on mount / deps change — serves LS cache instantly, revalidates in background. */
  const run = useCallback(() => doFetch(false), [path, cacheTtl]);

  /** Explicit refetch — always hits the network, bypasses localStorage cache. */
  const refetch = useCallback(() => doFetch(true), [path, cacheTtl]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { ...state, refetch };
}

/** Drop cached data for a path (e.g. after a mutation invalidates it). */
export function invalidate(path: string): void {
  memCache.delete(path);
  lsDel(path);
}
