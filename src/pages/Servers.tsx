import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { ServerBindings, ServerEntry, ZoneWithProvider } from "@/lib/types";
import { Link, useSearchParams } from "react-router-dom";
import { serverSaveError } from "@/lib/server-errors";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input, inputClass } from "@/components/Input";
import { SkeletonList } from "@/components/Skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { ErrorNote } from "@/components/ErrorNote";
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
  // Deep link from the IP usage page: /servers?edit=<id> opens that server's edit form.
  const [params, setParams] = useSearchParams();
  const editId = params.get("edit");

  const q = query.trim().toLowerCase();
  const filtered = (servers ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.ip.toLowerCase().includes(q) || (s.note ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("servers.title")}
        subtitle={t("servers.subtitle")}
        actions={
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
            {!showForm && <Icon name="plus" size={16} />}
            {showForm ? t("servers.cancel") : t("servers.addServer")}
          </Button>
        }
      />

      {showForm && (
        <ServerForm
          title={t("servers.addServer")}
          onSaved={() => { setShowForm(false); void refetch(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <div aria-label={t("servers.loading")}>
          <SkeletonList rows={3} />
        </div>
      ) : error ? (
        <Card>
          <ErrorNote message={error} onRetry={() => void refetch()} retryLabel={t("common.retry")} />
        </Card>
      ) : !servers || servers.length === 0 ? (
        <EmptyState
          icon={<Icon name="server" size={26} />}
          title={t("servers.noServers")}
          description={t("servers.noServersDesc")}
          action={!showForm ? <Button onClick={() => setShowForm(true)}><Icon name="plus" size={16} />{t("servers.addFirst")}</Button> : undefined}
        />
      ) : (
        <>
          {servers.length > 5 && (
            <div className="relative">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-slate-500" />
              <Input
                name="server-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("servers.searchPlaceholder")}
                aria-label={t("servers.searchPlaceholder")}
                className="pl-9"
                enterKeyHint="search"
              />
            </div>
          )}
          <ul className="stagger space-y-3">
            {filtered.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                zones={zones}
                onChanged={() => void refetch()}
                startEditing={s.id === editId}
                onEditHandled={() => { if (editId) setParams({}, { replace: true }); }}
              />
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
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
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
        {error && <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
  const [editing, setEditing] = useState(startEditing);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!startEditing) return;
    setEditing(true);
    rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    onEditHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing]);
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
    <li ref={rowRef}>
      <Card bodyClassName="p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 text-brand-800 dark:from-brand-400/20 dark:to-brand-300/10 dark:text-brand-200">
              <Icon name="server" size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{server.name}</h3>
                <Badge tone="accent">{server.ipVersion === 6 ? "IPv6 · AAAA" : "IPv4 · A"}</Badge>
              </div>
              <p className="mt-1 break-all font-mono text-sm text-slate-700 dark:text-slate-200">{server.ip}</p>
              <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {server.note && (
                  <div className="min-w-0">
                    <dt className="sr-only">{t("servers.note")}</dt>
                    <dd className="break-words">{server.note}</dd>
                  </div>
                )}
                <div>
                  <dt className="inline">{t("servers.updated")}:</dt>{" "}
                  <dd className="inline tabular-nums">{new Date(server.updatedAt).toLocaleDateString()}</dd>
                </div>
              </dl>
              {error && <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={confirming}
              aria-label={t("servers.editAria", { name: server.name })}
            >
              <Icon name="edit" size={14} />
              {t("servers.edit")}
            </Button>
            {!confirming && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={busy}
                aria-label={t("servers.deleteAria", { name: server.name })}
                className="!text-red-600 dark:!text-red-400"
              >
                <Icon name="trash" size={14} />
                {t("servers.delete")}
              </Button>
            )}
            <Button
              variant={showBindings ? "tinted" : "ghost"}
              size="sm"
              onClick={() => { setShowBindings((v) => !v); setBindings(null); }}
              disabled={confirming}
              aria-expanded={showBindings}
            >
              {showBindings ? t("servers.hideBindings") : t("servers.showBindings")}
            </Button>
          </div>
        </div>
        {confirming && (
          <div role="alertdialog" aria-label={t("servers.confirmDelete")} className="mt-4 flex animate-pop-in flex-col gap-3 rounded-xl bg-red-50 p-3.5 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:ring-red-500/20 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-800 dark:text-red-200">{t("servers.deleteHint")}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy} className="flex-1 sm:flex-none">
                {t("servers.cancel")}
              </Button>
              <Button variant="danger" size="sm" onClick={remove} loading={busy} className="flex-1 sm:flex-none">
                {t("servers.confirmDelete")}
              </Button>
            </div>
          </div>
        )}
        {showBindings && (
          <div className="mt-4 animate-fade-in rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-black/[0.04] dark:bg-white/[0.03] dark:ring-white/[0.05] sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <select
                aria-label={t("servers.pickDomain")}
                value={bindDomain}
                onChange={(e) => { setBindDomain(e.target.value); setBindings(null); }}
                className={`${inputClass} sm:w-72`}
              >
                <option value="">{t("servers.pickDomain")}</option>
                {zones.map((z) => (
                  <option key={`${z.providerId}:${z.id}`} value={z.id}>
                    {z.name} · {z.providerName}
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={loadBindings} loading={loadingBindings} disabled={!bindDomain}>
                {t("servers.checkDomain")}
              </Button>
              <Link to="/ips" className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 hover:underline dark:text-brand-300 sm:ml-auto sm:min-h-0">
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
                      <li key={b.recordId + b.content} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm shadow-xs dark:bg-white/[0.05]">
                        <Badge tone="brand" className="font-mono">{b.type}</Badge>
                        <span className="min-w-0 flex-1 truncate font-mono text-slate-900 dark:text-slate-100">{b.hostname}</span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">TTL {b.ttl}</span>
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
