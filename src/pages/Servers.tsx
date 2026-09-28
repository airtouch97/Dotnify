import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { ServerBindings, ServerEntry, ZoneWithProvider } from "@/lib/types";
import { Link, useSearchParams } from "react-router-dom";
import { serverSaveError } from "@/lib/server-errors";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Lightweight client-side check; the server does the authoritative validation. */
function looksLikeIp(v: string): boolean {
  const s = v.trim().replace(/^\[|\]$/g, "");
  if (IPV4.test(s)) return true;
  return s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s) && s.split("::").length <= 2;
}

export function Servers() {
  const { t } = useLang();
  const { data: servers, loading, error, refetch } = useFetch<ServerEntry[]>("/api/servers");
  // Same path/cache as the Home page, used by the per-domain "bound hostnames" check.
  const { data: zonesData } = useFetch<{ zones: ZoneWithProvider[] }>("/api/zones", { cacheTtl: 604800 });
  const zones = zonesData?.zones ?? [];
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  // /servers?edit=<id> opens that server's edit form (linked from the IP usage page).
  const [params, setParams] = useSearchParams();
  const editId = params.get("edit");
  const clearEdit = () => {
    const next = new URLSearchParams(params);
    next.delete("edit");
    setParams(next, { replace: true });
  };

  const q = query.trim().toLowerCase();
  const filtered = (servers ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.ip.toLowerCase().includes(q) || (s.note ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("servers.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("servers.subtitle")}</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
          {showForm ? t("servers.cancel") : t("servers.addServer")}
        </Button>
      </div>

      {showForm && (
        <ServerForm
          title={t("servers.addServer")}
          onSaved={() => { setShowForm(false); void refetch(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <Spinner label={t("servers.loading")} />
      ) : error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : !servers || servers.length === 0 ? (
        <EmptyState
          title={t("servers.noServers")}
          description={t("servers.noServersDesc")}
          action={!showForm ? <Button onClick={() => setShowForm(true)}>{t("servers.addFirst")}</Button> : undefined}
        />
      ) : (
        <>
          {servers.length > 5 && (
            <Input
              name="server-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("servers.searchPlaceholder")}
            />
          )}
          <ul className="space-y-3">
            {filtered.map((s) => (
              <ServerRow key={s.id} server={s} zones={zones} startEditing={s.id === editId} onEditHandled={clearEdit} onChanged={() => void refetch()} />
            ))}
          </ul>
        </>
      )}

    </div>
  );
}

function ServerForm({
  title,
  server,
  onSaved,
  onCancel,
}: {
  title: string;
  server?: ServerEntry;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const [name, setName] = useState(server?.name ?? "");
  const [ip, setIp] = useState(server?.ip ?? "");
  const [note, setNote] = useState(server?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t("servers.nameRequired"));
    if (!ip.trim()) return setError(t("servers.ipRequired"));
    if (!looksLikeIp(ip)) return setError(t("servers.ipInvalid"));
    setBusy(true);
    try {
      const body = { name: name.trim(), ip: ip.trim(), note: note.trim() };
      if (server) {
        await apiFetch(`/api/servers/${server.id}`, { method: "PATCH", body });
      } else {
        await apiFetch("/api/servers", { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setError(serverSaveError(err, name, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={title}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("servers.name")}
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("servers.namePlaceholder")}
            maxLength={64}
            required
            hint={t("servers.nameHint")}
          />
          <Input
            label={t("servers.ip")}
            name="ip"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="203.0.113.10 / 2001:db8::1"
            className="font-mono"
            required
            hint={t("servers.ipHint")}
          />
        </div>
        <Input
          label={t("servers.note")}
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("servers.notePlaceholder")}
          maxLength={500}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("servers.cancel")}</Button>
          <Button type="submit" loading={busy}>{t("servers.save")}</Button>
        </div>
      </form>
    </Card>
  );
}

function ServerRow({
  server,
  zones,
  onChanged,
  startEditing = false,
  onEditHandled,
}: {
  server: ServerEntry;
  zones: ZoneWithProvider[];
  onChanged: () => void;
  startEditing?: boolean;
  onEditHandled?: () => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!startEditing) return;
    setEditing(true);
    onEditHandled?.();
    requestAnimationFrame(() => rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [startEditing, onEditHandled]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBindings, setShowBindings] = useState(false);
  const [bindDomain, setBindDomain] = useState("");
  const [bindings, setBindings] = useState<ServerBindings | null>(null);
  const [loadingBindings, setLoadingBindings] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/servers/${server.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(serverSaveError(e, server.name, t, "servers.deleteFailed"));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  /** Check ONE domain for A/AAAA records pointing to this server (never scans all domains). */
  async function loadBindings() {
    if (!bindDomain) return;
    setLoadingBindings(true);
    setError(null);
    try {
      setBindings(await apiFetch<ServerBindings>(`/api/servers/${server.id}/bindings?domain=${encodeURIComponent(bindDomain)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("servers.bindingsFailed"));
    } finally {
      setLoadingBindings(false);
    }
  }

  if (editing) {
    return (
      <li ref={rowRef}>
        <ServerForm
          title={t("servers.editTitle", { name: server.name })}
          server={server}
          onSaved={() => { setEditing(false); setBindings(null); onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{server.name}</h3>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                {server.ipVersion === 6 ? "IPv6 · AAAA" : "IPv4 · A"}
              </span>
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <div>
                <dt className="inline">{t("servers.ip")}:</dt>{" "}
                <dd className="inline font-mono text-slate-700 dark:text-slate-300">{server.ip}</dd>
              </div>
              {server.note && (
                <div className="min-w-0">
                  <dt className="inline">{t("servers.note")}:</dt>{" "}
                  <dd className="inline break-all text-slate-700 dark:text-slate-300">{server.note}</dd>
                </div>
              )}
              <div>
                <dt className="inline">{t("servers.updated")}:</dt>{" "}
                <dd className="inline">{new Date(server.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={() => { setShowBindings((v) => !v); setBindings(null); }} disabled={confirming}>
              {showBindings ? t("servers.hideBindings") : t("servers.showBindings")}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={confirming} aria-label={t("servers.editAria", { name: server.name })}>
              {t("servers.edit")}
            </Button>
            {confirming ? (
              <>
                <Button variant="danger" onClick={remove} loading={busy}>
                  {t("servers.confirmDelete")}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  {t("servers.cancel")}
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy} aria-label={t("servers.deleteAria", { name: server.name })} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
                {t("servers.delete")}
              </Button>
            )}
          </div>
        </div>
        {confirming && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("servers.deleteHint")}</p>}
        {showBindings && (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bindDomain}
                onChange={(e) => { setBindDomain(e.target.value); setBindings(null); }}
                className="min-w-[14rem] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">{t("servers.pickDomain")}</option>
                {zones.map((z) => (
                  <option key={`${z.providerId}:${z.id}`} value={z.id}>
                    {z.name} · {z.providerName}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={loadBindings} loading={loadingBindings} disabled={!bindDomain} className="px-3 py-1.5 text-xs">
                {t("servers.checkDomain")}
              </Button>
              <Link to="/ips" className="ml-auto text-xs text-brand-600 hover:underline dark:text-brand-400">
                {t("servers.ipUsageLink")}
              </Link>
            </div>
            {bindings && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t("servers.bindingsTitle", { count: bindings.bindings.length, domain: bindings.domain })}
                </p>
                {bindings.bindings.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t("servers.noBindings")}</p>
                ) : (
                  <ul className="space-y-1">
                    {bindings.bindings.map((b) => (
                      <li key={b.recordId + b.content} className="flex items-center gap-3 text-sm">
                        <span className="w-12 font-mono text-xs text-slate-400">{b.type}</span>
                        <span className="font-mono text-slate-900 dark:text-slate-100">{b.hostname}</span>
                        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">TTL {b.ttl}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}
