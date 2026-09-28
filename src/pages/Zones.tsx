import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useFetch, invalidate } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { Provider, Zone, ZoneWithProvider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ProviderLogo } from "@/components/ProviderLogo";
import { SkeletonList } from "@/components/Skeleton";
import { PageHeader, UpdatingPill } from "@/components/PageHeader";
import { StatusBadge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { ErrorNote } from "@/components/ErrorNote";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";

interface ZonesResponse {
  zones: ZoneWithProvider[];
  errors: { providerId: string; providerName: string; message: string }[];
}

export function Zones() {
  const { t } = useLang();
  const { data, loading, error, isValidating, refetch } = useFetch<ZonesResponse>("/api/zones", { cacheTtl: 604800 });
  const zones = data?.zones ?? [];
  const providerErrors = data?.errors ?? [];
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("");

  const providerOptions = useMemo(() => {
    const names = [...new Set(zones.map((z) => z.providerName))];
    return [
      { value: "", label: t("zones.allProviders") },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [zones, t]);

  const filteredZones = useMemo(() => {
    return zones.filter((z) => {
      if (providerFilter && z.providerName !== providerFilter) return false;
      if (search && !z.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [zones, search, providerFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("zones.title")}
        subtitle={t("zones.subtitle")}
        status={isValidating && !loading ? <UpdatingPill label={t("zones.updating")} /> : null}
        actions={
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
            {!showForm && <Icon name="plus" size={16} />}
            {showForm ? t("zones.cancel") : t("zones.addDomain")}
          </Button>
        }
      />

      {showForm && <AddDomainForm managedZones={zones} onSaved={() => { invalidate("/api/zones"); setShowForm(false); void refetch(); }} onCancel={() => setShowForm(false)} />}

      {zones.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-slate-500" />
            <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("zones.searchPlaceholder")}
            className="pl-9"
            aria-label={t("zones.searchPlaceholder")}
            enterKeyHint="search"
          />
          </div>
          <Select
            options={providerOptions}
            value={providerFilter}
            onChange={(v) => setProviderFilter(String(v))}
            className="sm:w-52"
          />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={5} />
      ) : error ? (
        <Card>
          <ErrorNote message={error} onRetry={() => void refetch()} retryLabel={t("zones.retry")} />
        </Card>
      ) : filteredZones.length === 0 && zones.length > 0 ? (
        <EmptyState
          title={t("zones.noDomains")}
          description={t("zones.noDomainsDesc")}
        />
      ) : zones.length === 0 ? (
        <EmptyState
          title={t("zones.noDomains")}
          description={t("zones.noDomainsDesc")}
          action={<Link to="/providers"><Button>{t("zones.goToProviders")}</Button></Link>}
        />
      ) : (
        <ul className="surface overflow-hidden">
          {filteredZones.map((z) => (
            <ZoneRow key={`${z.providerId}:${z.id}`} zone={z} allZones={zones} onRemoved={() => { invalidate("/api/zones"); void refetch(); }} />
          ))}
        </ul>
      )}

      {providerErrors.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("zones.providersFailed")}</p>
          <ul className="mt-2 space-y-1">
            {providerErrors.map((e) => (
              <li key={e.providerId} className="text-xs text-red-600 dark:text-red-400">
                {e.providerName}: {e.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AddDomainForm({ managedZones, onSaved, onCancel }: { managedZones: ZoneWithProvider[]; onSaved: () => void; onCancel: () => void }) {
  const { t } = useLang();
  const { data: providers } = useFetch<Provider[]>("/api/providers");
  const [providerId, setProviderId] = useState("");
  const [step, setStep] = useState<"select-provider" | "select-zones">("select-provider");
  const [zones, setZones] = useState<Zone[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = providers?.find((p) => p.id === providerId);
  // Use the actual managed zones list (from /api/zones) to determine what's already added
  const managedIds = new Set(managedZones.filter((z) => z.providerId === providerId).map((z) => z.id));
  const unmanagedZones = zones.filter((z) => !managedIds.has(z.id));

  async function selectProvider(id: string) {
    setProviderId(id);
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<Zone[]>(`/api/providers/${id}/zones`);
      const allZones = Array.isArray(result) ? result : [];
      setZones(allZones);
      setSelected(new Set());
      setStep("select-zones");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch zones");
    } finally {
      setBusy(false);
    }
  }

  function toggleZone(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      // Merge existing managed zone IDs with newly selected ones
      const merged = [...managedIds, ...selected];
      await apiFetch(`/api/providers/${providerId}`, {
        method: "PATCH",
        body: { selectedZones: merged },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  if (step === "select-zones") {
    return (
      <Card title={t("zones.selectDomains")} description={t("zones.selectDomainsDesc", { provider: selectedProvider?.name ?? "this provider" })}>
        {unmanagedZones.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("zones.allManaged")}</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {unmanagedZones.map((z) => (
              <li key={z.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/[0.06]">
                  <input
                    type="checkbox"
                    checked={selected.has(z.id)}
                    onChange={() => toggleZone(z.id)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-white/15"
                  />
                  <span className="font-mono text-sm text-slate-900 dark:text-slate-100">{z.name}</span>
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{z.status}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => { setStep("select-provider"); setError(null); }} disabled={busy}>{t("zones.back")}</Button>
          <Button onClick={save} loading={busy} disabled={selected.size === 0}>
            {selected.size === 0 ? t("zones.selectToAdd") : t("zones.addCount", { count: selected.size })}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t("zones.addDomainTitle")} description={t("zones.addDomainDesc")}>
      {!providers || providers.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("zones.noProviders")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{t("zones.provider")}</label>
          <ul className="space-y-1">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void selectProvider(p.id)}
                  disabled={busy}
                  className="pressable flex min-h-[56px] w-full items-center gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-xs ring-1 ring-inset ring-black/[0.08] hover:bg-slate-50 hover:ring-black/15 disabled:opacity-50 dark:bg-white/[0.04] dark:ring-white/10 dark:hover:bg-white/[0.08]"
                >
                  <ProviderLogo type={p.type} />
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{p.name}</span>
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                    {p.selectedZones.length === 0 ? t("zones.allZones") : t("zones.zoneCount", { count: p.selectedZones.length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>{t("zones.cancel")}</Button>
      </div>
    </Card>
  );
}

function ZoneRow({ zone, allZones, onRemoved }: { zone: ZoneWithProvider; allZones: ZoneWithProvider[]; onRemoved: () => void }) {
  const { t } = useLang();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      // Collect all managed zone IDs for this provider, minus the one being removed
      const remaining = allZones
        .filter((z) => z.providerId === zone.providerId && z.id !== zone.id)
        .map((z) => z.id);
      await apiFetch(`/api/providers/${zone.providerId}`, {
        method: "PATCH",
        body: { selectedZones: remaining },
      });
      onRemoved();
    } catch {
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-b border-black/[0.05] last:border-b-0 dark:border-white/[0.06]">
      <div className="flex items-center gap-1 pr-2 sm:gap-2 sm:pr-3">
        <Link
          to={`/domains/${zone.id}/records`}
          state={{ providerId: zone.providerId, providerType: zone.providerType, zoneName: zone.name }}
          className="group flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 transition-colors duration-120 hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06] sm:pl-5"
        >
          <ProviderLogo type={zone.providerType} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm text-slate-900 dark:text-slate-100">{zone.name}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{zone.providerName}</span>
          </span>
          <StatusBadge status={zone.status} />
          <span className="hidden text-sm font-medium text-brand-700 dark:text-brand-300 md:inline">{t("zones.viewRecords")}</span>
          <Icon name="chevron-right" size={16} className="text-slate-300 transition-transform duration-160 ease-out group-hover:translate-x-0.5 dark:text-slate-600" />
        </Link>
        {confirming ? (
          <div className="flex shrink-0 animate-pop-in items-center gap-1.5">
            <Button variant="danger" size="sm" onClick={remove} disabled={busy} loading={busy}>
              {t("zones.confirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              {t("zones.cancel")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`${t("zones.delete")} ${zone.name}`}
            title={t("zones.delete")}
            className="tap-square pressable grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <Icon name="trash" size={17} />
          </button>
        )}
      </div>
    </li>
  );
}
