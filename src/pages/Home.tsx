import { Link } from "react-router-dom";
import { useFetch } from "@/hooks/useFetch";
import { useLang } from "@/lib/i18n";
import type { ZoneWithProvider, Provider } from "@/lib/types";
import { Button } from "@/components/Button";
import { ProviderLogo } from "@/components/ProviderLogo";
import { StatusBadge } from "@/components/Badge";
import { Icon, type IconName } from "@/components/Icon";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";

interface ZonesResponse {
  zones: ZoneWithProvider[];
  errors: { providerId: string; providerName: string; message: string }[];
}

export function Home() {
  const { t } = useLang();
  const { data, loading } = useFetch<ZonesResponse>("/api/zones", { cacheTtl: 604800 });
  const { data: providers, loading: providersLoading } = useFetch<Provider[]>("/api/providers");
  const zones = data?.zones ?? [];
  const providerCount = providers?.length ?? 0;
  const activeCount = zones.filter((z) => z.status === "active").length;
  const activePct = zones.length ? Math.round((activeCount / zones.length) * 100) : 0;
  const statsLoading = (loading && !data) || (providersLoading && !providers);

  return (
    <div className="space-y-8 sm:space-y-10">
      <PageHeader title={t("home.title")} subtitle={t("home.subtitle")} />

      <section>
        <SectionLabel>{t("home.overview")}</SectionLabel>
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <StatTile to="/providers" icon="plug" tone="primary" value={providerCount} label={t("home.providers")} loading={statsLoading} />
          <StatTile to="/domains" icon="globe" tone="secondary" value={zones.length} label={t("home.domains")} loading={statsLoading} />
          <div className="surface col-span-2 flex flex-col justify-between gap-4 p-5 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-800 dark:bg-brand-300/15 dark:text-brand-200">
                <Icon name="check" size={18} />
              </span>
              <span className="text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">{zones.length ? `${activePct}%` : "—"}</span>
            </div>
            <div>
              {statsLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <p className="text-[32px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{activeCount}</p>
              )}
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t("home.active")}</p>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-white/[0.08]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={activePct}
                aria-label={t("home.active")}
              >
                <div
                  className="h-full origin-left rounded-full bg-gradient-to-r from-brand-300 to-brand-500 transition-transform duration-500 ease-out"
                  style={{ transform: `scaleX(${activePct / 100})` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {loading && !data ? (
        <section>
          <SectionLabel>{t("home.recentDomains")}</SectionLabel>
          <SkeletonList rows={4} />
        </section>
      ) : zones.length > 0 ? (
        <section>
          <div className="flex items-baseline justify-between">
            <SectionLabel>{t("home.recentDomains")}</SectionLabel>
            {zones.length > 10 && (
              <Link to="/domains" className="mb-2.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                {t("home.viewAllDomains", { count: zones.length })}
              </Link>
            )}
          </div>
          <ul className="surface overflow-hidden">
            {zones.slice(0, 10).map((z) => (
              <li key={`${z.providerId}:${z.id}`} className="border-b border-black/[0.05] last:border-b-0 dark:border-white/[0.06]">
                <Link
                  to={`/domains/${z.id}/records`}
                  state={{ providerId: z.providerId, providerType: z.providerType, zoneName: z.name }}
                  className="group flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors duration-120 hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06] sm:px-5"
                >
                  <ProviderLogo type={z.providerType} />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-900 dark:text-slate-100">{z.name}</span>
                  <StatusBadge status={z.status} />
                  <Icon name="chevron-right" size={16} className="text-slate-300 transition-transform duration-160 ease-out group-hover:translate-x-0.5 dark:text-slate-600" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyOrNewState providerCount={providerCount} />
      )}
    </div>
  );
}

const TILE_TONES = {
  primary: "bg-brand-600 text-white",
  secondary: "bg-brand-300 text-brand-950",
} as const;

function StatTile({
  to,
  icon,
  tone,
  value,
  label,
  loading,
}: {
  to: string;
  icon: IconName;
  tone: keyof typeof TILE_TONES;
  value: number;
  label: string;
  loading: boolean;
}) {
  return (
    <Link
      to={to}
      className="surface pressable group flex flex-col justify-between gap-4 p-5 hover:shadow-pop dark:hover:shadow-pop-dark"
    >
      <div className="flex items-center justify-between">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${TILE_TONES[tone]}`}>
          <Icon name={icon} size={18} />
        </span>
        <Icon name="chevron-right" size={16} className="text-slate-300 transition-transform duration-160 ease-out group-hover:translate-x-0.5 dark:text-slate-600" />
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <p className="text-[32px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{value}</p>
        )}
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </Link>
  );
}

function EmptyOrNewState({ providerCount }: { providerCount: number }) {
  const { t } = useLang();

  if (providerCount === 0) {
    return (
      <EmptyState
        icon={<Icon name="plug" size={26} />}
        title={t("home.addProvider")}
        description={t("home.getStarted")}
        action={
          <Link to="/providers" tabIndex={-1}>
            <Button>
              <Icon name="plus" size={16} />
              {t("home.addProvider")}
            </Button>
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<Icon name="globe" size={26} />}
      title={t("home.domains")}
      description={t("home.noDomains")}
      action={
        <Link to="/providers" tabIndex={-1}>
          <Button variant="secondary">{t("home.manageProviders")}</Button>
        </Link>
      }
    />
  );
}
