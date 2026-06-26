import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFetch } from "@/hooks/useFetch";
import type { Provider, Zone } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

export function Zones() {
  const { data: providers, loading: loadingProviders } = useFetch<Provider[]>("/api/providers");
  const [providerId, setProviderId] = useState<string | null>(null);

  // Auto-select the first provider once the list loads.
  useEffect(() => {
    if (providers && providers.length > 0 && !providerId) {
      setProviderId(providers[0].id);
    }
  }, [providers, providerId]);

  const zonesPath = providerId ? `/api/providers/${providerId}/zones` : null;
  const { data: zones, loading: loadingZones, error, refetch } = useFetch<Zone[]>(zonesPath, [providerId]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Zones</h1>
        <p className="mt-0.5 text-sm text-slate-500">Pick a provider to list its DNS zones.</p>
      </div>

      {loadingProviders ? (
        <Spinner label="Loading providers" />
      ) : !providers || providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="Add a provider first, then come back to browse its zones."
          action={<Link to="/providers"><Button>Go to providers</Button></Link>}
        />
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-2">
              <label htmlFor="provider" className="text-sm font-medium text-slate-700">
                Provider
              </label>
              <select
                id="provider"
                value={providerId ?? ""}
                onChange={(e) => setProviderId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </select>
            </div>
          </Card>

          {providerId && (
            loadingZones ? (
              <Spinner label="Loading zones" />
            ) : error ? (
              <Card>
                <p className="text-sm text-red-600">{error}</p>
                <Button variant="secondary" className="mt-3" onClick={() => void refetch()}>Retry</Button>
              </Card>
            ) : !zones || zones.length === 0 ? (
              <EmptyState title="No zones found" description="This token has no accessible zones." />
            ) : (
              <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {zones.map((z) => (
                  <li key={z.id} className="border-b border-slate-100 last:border-b-0">
                    <Link
                      to={`/zones/${z.id}/records?providerId=${providerId}`}
                      className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-slate-50"
                    >
                      <span className="font-mono text-sm text-slate-900">{z.name}</span>
                      <span className="flex items-center gap-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                          z.status === "active"
                            ? "bg-green-50 text-green-700"
                            : "bg-slate-100 text-slate-600"
                        }`}>
                          {z.status}
                        </span>
                        <span className="text-sm text-brand-600">View records →</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
    </div>
  );
}
