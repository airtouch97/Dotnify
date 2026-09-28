import { ApiError } from "./api";

type T = (key: string, params?: Record<string, string | number>) => string;

/** Human-friendly message for server-table save errors (duplicate names etc.). */
export function serverSaveError(err: unknown, name: string, t: T, fallbackKey = "servers.saveFailed"): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return t("servers.duplicateName", { name: name.trim() });
    if (err.status === 404) return t("servers.notFound");
    if (err.message) return err.message;
  }
  return err instanceof Error && err.message ? err.message : t(fallbackKey);
}
