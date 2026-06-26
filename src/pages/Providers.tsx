import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import type { Provider } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

export function Providers() {
  const { data: providers, loading, error, refetch } = useFetch<Provider[]>("/api/providers");
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">DNS Providers</h1>
          <p className="mt-0.5 text-sm text-slate-500">Manage the API tokens used to access your DNS zones.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
          {showForm ? "Cancel" : "Add provider"}
        </Button>
      </div>

      {showForm && <AddForm onSaved={() => { setShowForm(false); void refetch(); }} />}

      {loading ? (
        <Spinner label="Loading providers" />
      ) : error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : !providers || providers.length === 0 ? (
        <EmptyState
          title="No providers yet"
          description="Add a Cloudflare API token to start managing its DNS records."
          action={<Button onClick={() => setShowForm(true)}>Add your first provider</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onChanged={() => void refetch()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/providers", {
        method: "POST",
        body: { type: "cloudflare", name, apiKey },
      });
      setName("");
      setApiKey("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add provider");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add Cloudflare provider">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Display name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Cloudflare account"
          required
          hint="A label so you can tell providers apart later."
        />
        <Input
          label="API token"
          name="apiKey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Cloudflare API token"
          required
          hint="We verify the token against Cloudflare before saving it."
          error={error}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>Add</Button>
        </div>
      </form>
    </Card>
  );
}

function ProviderRow({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function testConnection() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/providers/${provider.id}/zones`, { allow401: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/providers/${provider.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete provider");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">
                {provider.type}
              </span>
              <h3 className="truncate text-sm font-semibold text-slate-900">{provider.name}</h3>
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-slate-500">
              <div>
                <dt className="inline">Token:</dt>{" "}
                <dd className="inline font-mono text-slate-700">{provider.apiKey}</dd>
              </div>
              <div>
                <dt className="inline">Added:</dt>{" "}
                <dd className="inline">{new Date(provider.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={testConnection} loading={busy && !confirming} disabled={confirming}>
              Test
            </Button>
            {confirming ? (
              <>
                <Button variant="danger" onClick={remove} loading={busy}>
                  Confirm delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy} className="text-red-600 hover:bg-red-50">
                Delete
              </Button>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}
