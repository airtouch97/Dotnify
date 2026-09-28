import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useFetch, invalidate } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { Provider, ProviderType, Zone } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import { Input, inputClass } from "@/components/Input";
import { SkeletonList } from "@/components/Skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { ErrorNote } from "@/components/ErrorNote";
import { EmptyState } from "@/components/EmptyState";
import { ProviderLogo } from "@/components/ProviderLogo";

const HW_REGIONS = [
  { value: "cn-north-1", label: "North Beijing-1" },
  { value: "cn-north-4", label: "North Beijing-4" },
  { value: "cn-east-2", label: "East Shanghai-2" },
  { value: "cn-east-3", label: "East Shanghai-1" },
  { value: "cn-south-1", label: "South Guangzhou" },
  { value: "cn-southwest-2", label: "Southwest Guiyang-1" },
  { value: "ap-southeast-1", label: "Hong Kong" },
  { value: "ap-southeast-2", label: "Bangkok" },
  { value: "ap-southeast-3", label: "Singapore" },
];

export function Providers() {
  const { t } = useLang();
  const { data: providers, loading, error, refetch } = useFetch<Provider[]>("/api/providers");
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("providers.title")}
        subtitle={t("providers.subtitle")}
        actions={
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
            {!showForm && <Icon name="plus" size={16} />}
            {showForm ? t("providers.cancel") : t("providers.addProvider")}
          </Button>
        }
      />

      {showForm && <AddForm onSaved={() => { invalidate("/api/zones"); setShowForm(false); void refetch(); }} onCancel={() => setShowForm(false)} />}

      {loading ? (
        <SkeletonList rows={2} />
      ) : error ? (
        <Card>
          <ErrorNote message={error} onRetry={() => void refetch()} retryLabel={t("common.retry")} />
        </Card>
      ) : !providers || providers.length === 0 ? (
        <EmptyState
          icon={<Icon name="plug" size={26} />}
          title={t("providers.noProviders")}
          description={t("providers.noProvidersDesc")}
          action={<Button onClick={() => setShowForm(true)}><Icon name="plus" size={16} />{t("providers.addFirst")}</Button>}
        />
      ) : (
        <ul className="stagger space-y-3">
          {providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onChanged={() => { invalidate("/api/zones"); void refetch(); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { t } = useLang();
  const [providerType, setProviderType] = useState<ProviderType>("cloudflare");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiAccessKey, setApiAccessKey] = useState("");
  const [apiSecretKey, setApiSecretKey] = useState("");
  const [region, setRegion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"input" | "select">("input");
  const [zones, setZones] = useState<Zone[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 1: verify credentials + fetch zones (nothing persisted yet).
  async function verifyAndFetchZones(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("providers.nameRequired"));
      return;
    }
    if (providerType === "cloudflare" && !apiKey.trim()) {
      setError(t("providers.apiTokenRequired"));
      return;
    }
    if (providerType === "huawei") {
      if (!apiAccessKey.trim() || !apiSecretKey.trim()) {
        setError(t("providers.akSkRequired"));
        return;
      }
    }
    if (providerType === "dnspod") {
      if (!apiAccessKey.trim() || !apiSecretKey.trim()) {
        setError(t("providers.akSkRequired"));
        return;
      }
    }
    if (providerType === "aliyun") {
      if (!apiAccessKey.trim() || !apiSecretKey.trim()) {
        setError(t("providers.akSkRequired"));
        return;
      }
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = { type: providerType };
      if (providerType === "cloudflare") {
        body.apiKey = apiKey.trim();
      } else if (providerType === "huawei") {
        body.apiAccessKey = apiAccessKey.trim();
        body.apiSecretKey = apiSecretKey.trim();
        if (region) body.region = region;
      } else if (providerType === "dnspod") {
        body.apiAccessKey = apiAccessKey.trim();
        body.apiSecretKey = apiSecretKey.trim();
      } else if (providerType === "aliyun") {
        body.apiAccessKey = apiAccessKey.trim();
        body.apiSecretKey = apiSecretKey.trim();
      }
      const result = await apiFetch<Zone[]>("/api/providers/verify", {
        method: "POST",
        body,
      });
      setZones(Array.isArray(result) ? result : []);
      setSelected(new Set());
      setStep("select");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("providers.verificationFailed"));
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

  // Step 2: persist the provider with the selected zones in one shot.
  async function save() {
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        type: providerType,
        name: name.trim(),
        selectedZones: [...selected],
      };
      if (providerType === "cloudflare") {
        body.apiKey = apiKey.trim();
      } else if (providerType === "huawei") {
        body.apiAccessKey = apiAccessKey.trim();
        body.apiSecretKey = apiSecretKey.trim();
        if (region) body.region = region;
      } else if (providerType === "dnspod") {
        body.apiAccessKey = apiAccessKey.trim();
        body.apiSecretKey = apiSecretKey.trim();
      } else if (providerType === "aliyun") {
        body.apiAccessKey = apiAccessKey.trim();
        body.apiSecretKey = apiSecretKey.trim();
      }
      await apiFetch("/api/providers", {
        method: "POST",
        body,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("providers.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (step === "select") {
    return (
      <Card title={t("providers.selectZones")} description={t("providers.selectZonesDesc")}>
        {zones.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("providers.noAccessibleZones")}</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {zones.map((z) => (
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
          <Button variant="secondary" onClick={() => { setStep("input"); setError(null); }} disabled={busy}>{t("zones.back")}</Button>
          <Button onClick={save} loading={busy}>
            {selected.size === 0 ? t("providers.saveAllZones") : t("providers.saveCount", { count: selected.size })}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={providerType === "huawei" ? t("providers.addHuawei") : providerType === "dnspod" ? t("providers.addDnspod") : providerType === "aliyun" ? t("providers.addAliyun") : t("providers.addCloudflare")}>
      <form onSubmit={verifyAndFetchZones} className="flex flex-col gap-4">
        <Select
          label={t("providers.providerType")}
          value={providerType}
          onChange={(v) => setProviderType(v as ProviderType)}
          options={[
            { value: "cloudflare", label: "Cloudflare" },
            { value: "huawei", label: t("providers.huaweiCloud") },
            { value: "dnspod", label: t("providers.tencentCloud") },
            { value: "aliyun", label: t("providers.aliyunCloud") },
          ]}
        />
        <Input
          label={t("providers.displayName")}
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={providerType === "cloudflare" ? t("providers.placeholderCloudflare") : providerType === "dnspod" ? t("providers.placeholderDnspod") : providerType === "aliyun" ? t("providers.placeholderAliyun") : t("providers.placeholderHuawei")}
          required
          hint={t("providers.nameHint")}
        />
        {providerType === "cloudflare" ? (
          <Input
            label={t("providers.apiToken")}
            name="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Cloudflare API token"
            required
            hint={t("providers.cfTokenHint")}
            error={error}
          />
        ) : providerType === "dnspod" ? (
          <>
            <Input
              label={t("providers.secretId")}
              name="apiAccessKey"
              type="password"
              value={apiAccessKey}
              onChange={(e) => setApiAccessKey(e.target.value)}
              placeholder="Tencent Cloud SecretId"
              required
              hint={t("providers.dpSidHint")}
            />
            <Input
              label={t("providers.secretKey")}
              name="apiSecretKey"
              type="password"
              value={apiSecretKey}
              onChange={(e) => setApiSecretKey(e.target.value)}
              placeholder="Tencent Cloud SecretKey"
              required
              hint={t("providers.dpSkHint")}
            />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </>
        ) : providerType === "aliyun" ? (
          <>
            <Input
              label={t("providers.accessKeyId")}
              name="apiAccessKey"
              type="password"
              value={apiAccessKey}
              onChange={(e) => setApiAccessKey(e.target.value)}
              placeholder="Alibaba Cloud AccessKey ID"
              required
              hint={t("providers.aliAkHint")}
            />
            <Input
              label={t("providers.secretAccessKey")}
              name="apiSecretKey"
              type="password"
              value={apiSecretKey}
              onChange={(e) => setApiSecretKey(e.target.value)}
              placeholder="Alibaba Cloud AccessKey Secret"
              required
              hint={t("providers.aliSkHint")}
            />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </>
        ) : (
          <>
            <Input
              label={t("providers.accessKeyId")}
              name="apiAccessKey"
              type="password"
              value={apiAccessKey}
              onChange={(e) => setApiAccessKey(e.target.value)}
              placeholder="Huawei Cloud AK"
              required
              hint={t("providers.hwAkHint")}
            />
            <Input
              label={t("providers.secretAccessKey")}
              name="apiSecretKey"
              type="password"
              value={apiSecretKey}
              onChange={(e) => setApiSecretKey(e.target.value)}
              placeholder="Huawei Cloud SK"
              required
              hint={t("providers.hwSkHint")}
            />
            <div className="flex flex-col gap-1">
              <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{t("providers.region")}</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className={inputClass}
              >
                <option value="">{t("providers.regionDefault")}</option>
                {HW_REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} ({r.value})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("providers.regionHint")}</p>
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("providers.cancel")}</Button>
          <Button type="submit" loading={busy}>{t("providers.verifyContinue")}</Button>
        </div>
      </form>
    </Card>
  );
}

function ProviderRow({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/providers/${provider.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("providers.deleteFailed"));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li>
        <EditProviderForm
          provider={provider}
          onSaved={() => { setEditing(false); onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const zoneCount = provider.selectedZones.length;

  return (
    <li>
      <Card bodyClassName="p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-xs ring-1 ring-black/[0.06] dark:bg-white/[0.08] dark:ring-white/[0.08]">
              <ProviderLogo type={provider.type} />
            </span>
            <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{provider.name}</h3>
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {provider.type === "cloudflare" ? (
                <div>
                  <dt className="inline">{t("providers.token")}:</dt>{" "}
                  <dd className="inline font-mono text-slate-700 dark:text-slate-300">{provider.apiKey}</dd>
                </div>
              ) : provider.type === "dnspod" || provider.type === "aliyun" ? (
                <div>
                  <dt className="inline">{t("providers.ak")}:</dt>{" "}
                  <dd className="inline font-mono text-slate-700 dark:text-slate-300">{provider.apiAccessKey}</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt className="inline">{t("providers.ak")}:</dt>{" "}
                    <dd className="inline font-mono text-slate-700 dark:text-slate-300">{provider.apiAccessKey}</dd>
                  </div>
                  <div>
                    <dt className="inline">{t("providers.region")}:</dt>{" "}
                    <dd className="inline text-slate-700 dark:text-slate-300">{provider.region}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="inline">{t("providers.zones")}:</dt>{" "}
                <dd className="inline text-slate-700 dark:text-slate-300">{zoneCount === 0 ? t("providers.all") : zoneCount}</dd>
              </div>
              <div>
                <dt className="inline">{t("providers.added")}:</dt>{" "}
                <dd className="inline">{new Date(provider.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            {error && <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={confirming}>
              <Icon name="edit" size={14} />
              {t("providers.edit")}
            </Button>
            {confirming ? (
              <span className="flex animate-pop-in items-center gap-2">
                <Button variant="danger" size="sm" onClick={remove} loading={busy}>
                  {t("providers.confirmDelete")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  {t("providers.cancel")}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={busy} className="!text-red-600 dark:text-red-400 hover:!bg-red-50 dark:!text-red-400 dark:hover:!bg-red-500/10">
                <Icon name="trash" size={14} />
                {t("providers.delete")}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}

function EditProviderForm({ provider, onSaved, onCancel }: { provider: Provider; onSaved: () => void; onCancel: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState(provider.name);
  const [apiKey, setApiKey] = useState("");
  const [apiAccessKey, setApiAccessKey] = useState("");
  const [apiSecretKey, setApiSecretKey] = useState("");
  const [region, setRegion] = useState(provider.region ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("providers.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (provider.type === "cloudflare" && apiKey.trim()) {
        body.apiKey = apiKey.trim();
      }
      if (provider.type === "huawei") {
        if (apiAccessKey.trim()) body.apiAccessKey = apiAccessKey.trim();
        if (apiSecretKey.trim()) body.apiSecretKey = apiSecretKey.trim();
        if (region !== (provider.region ?? "")) body.region = region;
      }
      if (provider.type === "dnspod") {
        if (apiAccessKey.trim()) body.apiAccessKey = apiAccessKey.trim();
        if (apiSecretKey.trim()) body.apiSecretKey = apiSecretKey.trim();
      }
      if (provider.type === "aliyun") {
        if (apiAccessKey.trim()) body.apiAccessKey = apiAccessKey.trim();
        if (apiSecretKey.trim()) body.apiSecretKey = apiSecretKey.trim();
      }
      await apiFetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        body,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("providers.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("providers.editTitle", { name: provider.name })}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Input
          label={t("providers.displayName")}
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My provider"
          required
        />
        {provider.type === "cloudflare" ? (
          <Input
            label={t("providers.apiToken")}
            name="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("providers.leaveBlankToken")}
          />
        ) : provider.type === "dnspod" ? (
          <>
            <Input
              label={t("providers.secretId")}
              name="apiAccessKey"
              type="password"
              value={apiAccessKey}
              onChange={(e) => setApiAccessKey(e.target.value)}
              placeholder={t("providers.leaveBlankKey")}
            />
            <Input
              label={t("providers.secretKey")}
              name="apiSecretKey"
              type="password"
              value={apiSecretKey}
              onChange={(e) => setApiSecretKey(e.target.value)}
              placeholder={t("providers.leaveBlankKey")}
            />
          </>
        ) : provider.type === "aliyun" ? (
          <>
            <Input
              label={t("providers.accessKeyId")}
              name="apiAccessKey"
              type="password"
              value={apiAccessKey}
              onChange={(e) => setApiAccessKey(e.target.value)}
              placeholder={t("providers.leaveBlankKey")}
            />
            <Input
              label={t("providers.secretAccessKey")}
              name="apiSecretKey"
              type="password"
              value={apiSecretKey}
              onChange={(e) => setApiSecretKey(e.target.value)}
              placeholder={t("providers.leaveBlankKey")}
            />
          </>
        ) : (
          <>
            <Input
              label={t("providers.accessKeyId")}
              name="apiAccessKey"
              type="password"
              value={apiAccessKey}
              onChange={(e) => setApiAccessKey(e.target.value)}
              placeholder={t("providers.leaveBlankKey")}
            />
            <Input
              label={t("providers.secretAccessKey")}
              name="apiSecretKey"
              type="password"
              value={apiSecretKey}
              onChange={(e) => setApiSecretKey(e.target.value)}
              placeholder={t("providers.leaveBlankKey")}
            />
            <div className="flex flex-col gap-1">
              <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{t("providers.region")}</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className={inputClass}
              >
                <option value="">{t("providers.regionDefault")}</option>
                {HW_REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} ({r.value})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("providers.cancel")}</Button>
          <Button type="submit" loading={busy}>{t("providers.save")}</Button>
        </div>
      </form>
    </Card>
  );
}
