import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { Provider, Zone, ZoneWithProvider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ProviderLogo } from "@/components/ProviderLogo";
import { Skeleton } from "@/components/Skeleton";

interface ZonesResponse {
  zones: ZoneWithProvider[];
  errors: { providerId: string; providerName: string; message: string }[];
}

export function Zones() {
  const { t } = useLang();
  const { data, loading, error, isValidating, refetch } = useFetch<ZonesResponse>("/api/zones");
  const zones = data?.zones ?? [];
  const providerErrors = data?.errors ?? [];
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("zones.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("zones.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {isValidating && !loading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              {t("zones.updating")}
            </span>
          )}
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
            {showForm ? t("zones.cancel") : t("zones.addDomain")}
          </Button>
        </div>
      </div>

      {showForm && <AddDomainForm managedZones={zones} onSaved={() => { setShowForm(false); void refetch(); }} onCancel={() => setShowForm(false)} />}

      {loading ? (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="border-b border-slate-100 last:border-b-0 px-5 py-3 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="ml-auto h-5 w-16 rounded-md" />
              </div>
            </li>
          ))}
        </ul>
      ) : error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void refetch()}>{t("zones.retry")}</Button>
        </Card>
      ) : zones.length === 0 ? (
        <EmptyState
          title={t("zones.noDomains")}
          description={t("zones.noDomainsDesc")}
          action={<Link to="/providers"><Button>{t("zones.goToProviders")}</Button></Link>}
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {zones.map((z) => (
            <ZoneRow key={`${z.providerId}:${z.id}`} zone={z} allZones={zones} onRemoved={() => void refetch()} />
          ))}
        </ul>
      )}

      {providerErrors.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("zones.providersFailed")}</p>
          <ul className="mt-2 space-y-1">
            {providerErrors.map((e) => (
              <li key={e.providerId} className="text-xs text-red-600">
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
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <input
                    type="checkbox"
                    checked={selected.has(z.id)}
                    onChange={() => toggleZone(z.id)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
                  />
                  <span className="font-mono text-sm text-slate-900 dark:text-slate-100">{z.name}</span>
                  <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{z.status}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
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
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("zones.provider")}</label>
          <ul className="space-y-1">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void selectProvider(p.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-700"
                >
                  <ProviderLogo type={p.type} />
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{p.name}</span>
                  <ProviderLogo type={p.type} />
                  <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                    {p.selectedZones.length === 0 ? t("zones.allZones") : t("zones.zoneCount", { count: p.selectedZones.length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
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
    <li className="border-b border-slate-100 last:border-b-0 dark:border-slate-700">
      <div className="flex items-center gap-3 px-5 py-3">
        <Link
          to={`/domains/${zone.id}/records?providerId=${zone.providerId}&providerType=${zone.providerType}&zoneName=${encodeURIComponent(zone.name)}`}
          className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:bg-slate-50 -mx-5 -my-3 px-5 py-3 dark:hover:bg-slate-700"
        >
          <ProviderLogo type={zone.providerType} />
          <span className="font-mono text-sm text-slate-900 dark:text-slate-100">{zone.name}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{zone.providerName}</span>
          <span className="ml-auto flex items-center gap-3">
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${
              zone.status === "active"
                ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
            }`}>
              {zone.status}
            </span>
            <span className="text-sm text-brand-600 dark:text-brand-400">{t("zones.viewRecords")}</span>
          </span>
        </Link>
        {confirming ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {t("zones.confirm")}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {t("zones.cancel")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
          >
            {t("zones.delete")}
          </button>
        )}
      </div>
    </li>
  );
}
