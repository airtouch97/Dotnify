import { Link } from "react-router-dom";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { ZoneWithProvider, Provider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ProviderLogo } from "@/components/ProviderLogo";

interface ZonesResponse {
  zones: ZoneWithProvider[];
  errors: { providerId: string; providerName: string; message: string }[];
}

export function Home() {
  const { t } = useLang();
  const { data } = useFetch<ZonesResponse>("/api/zones");
  const { data: providers } = useFetch<Provider[]>("/api/providers");
  const zones = data?.zones ?? [];
  const providerCount = providers?.length ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("home.title")}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">{providerCount}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("home.providers")}</p>
        </Card>
        <Card>
          <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">{zones.length}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("home.domains")}</p>
        </Card>
        <Card>
          <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
            {zones.filter((z) => z.status === "active").length}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("home.active")}</p>
        </Card>
      </div>

      {zones.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t("home.domains")}</h2>
          <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {zones.slice(0, 10).map((z) => (
              <li key={`${z.providerId}:${z.id}`} className="border-b border-slate-100 last:border-b-0 dark:border-slate-700">
                <Link
                  to={`/domains/${z.id}/records`}
                  state={{ providerId: z.providerId, providerType: z.providerType, zoneName: z.name }}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <ProviderLogo type={z.providerType} />
                  <span className="font-mono text-sm text-slate-900 dark:text-slate-100">{z.name}</span>
                  <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-medium ${
                    z.status === "active"
                      ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}>
                    {z.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {zones.length > 10 && (
            <Link to="/domains" className="mt-2 block text-center text-sm text-brand-600 hover:underline dark:text-brand-400">
              {t("home.viewAllDomains", { count: zones.length })}
            </Link>
          )}
        </div>
      ) : (
        <EmptyOrNewState providerCount={providerCount} />
      )}
    </div>
  );
}

function EmptyOrNewState({ providerCount }: { providerCount: number }) {
  const { t } = useLang();

  if (providerCount === 0) {
    return (
      <Card>
        <div className="py-4 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("home.getStarted")}</p>
          <Link to="/providers" className="mt-3 inline-block">
            <Button>{t("home.addProvider")}</Button>
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="py-4 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("home.noDomains")}</p>
        <Link to="/providers" className="mt-3 inline-block">
          <Button variant="secondary">{t("home.manageProviders")}</Button>
        </Link>
      </div>
    </Card>
  );
}
