import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import type { DnsRecord, RecordType } from "@/lib/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

const RECORD_TYPES: RecordType[] = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA", "PTR", "SOA", "SPF", "URI"];

export function Records() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const [search] = useSearchParams();
  const providerId = search.get("providerId");

  const path = zoneId && providerId ? `/api/zones/${zoneId}/records?providerId=${providerId}` : null;
  const { data: records, loading, error, refetch } = useFetch<DnsRecord[]>(path);

  const [editing, setEditing] = useState<DnsRecord | null>(null);
  const [creating, setCreating] = useState(false);

  if (!zoneId || !providerId) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState title="Missing parameters" description="Open this page from the Zones list." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/zones" className="text-sm text-brand-600 hover:underline">← Back to zones</Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">DNS records</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Zone <span className="font-mono text-slate-700">{zoneId}</span>
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setCreating((v) => !v); }} variant={creating ? "secondary" : "primary"}>
          {creating ? "Cancel" : "Add record"}
        </Button>
      </div>

      {creating && (
        <RecordForm
          zoneId={zoneId}
          providerId={providerId}
          onDone={() => { setCreating(false); void refetch(); }}
        />
      )}

      {editing && (
        <RecordForm
          zoneId={zoneId}
          providerId={providerId}
          record={editing}
          onDone={() => { setEditing(null); void refetch(); }}
        />
      )}

      {loading ? (
        <Spinner label="Loading records" />
      ) : error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void refetch()}>Retry</Button>
        </Card>
      ) : !records || records.length === 0 ? (
        <EmptyState title="No records" description="This zone has no DNS records yet." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Content</th>
                  <th className="px-4 py-2 font-medium">TTL</th>
                  <th className="px-4 py-2 font-medium">Proxied</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-b-0 align-top">
                    <td className="px-4 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{r.type}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-900">{r.name}</td>
                    <td className="px-4 py-2 font-mono text-slate-700 break-all">
                      {r.content}
                      {r.priority !== undefined && r.priority !== null && (
                        <span className="ml-1 text-xs text-slate-400">(pri {r.priority})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{r.ttl === 1 ? "Auto" : r.ttl}</td>
                    <td className="px-4 py-2 text-slate-600">{r.proxied ? "Yes" : "No"}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <DeleteButton
                          zoneId={zoneId}
                          providerId={providerId}
                          recordId={r.id}
                          onDone={() => void refetch()}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function RecordForm({
  zoneId,
  providerId,
  record,
  onDone,
}: {
  zoneId: string;
  providerId: string;
  record?: DnsRecord;
  onDone: () => void;
}) {
  const isEdit = !!record;
  const [type, setType] = useState<RecordType>(record?.type ?? "A");
  const [name, setName] = useState(record?.name ?? "");
  const [content, setContent] = useState(record?.content ?? "");
  const [ttl, setTtl] = useState<number>(record?.ttl ?? 1);
  const [proxied, setProxied] = useState<boolean>(record?.proxied ?? false);
  const [priority, setPriority] = useState<string>(
    record?.priority !== undefined && record?.priority !== null ? String(record.priority) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || content === "") {
      setError("Name and content are required");
      return;
    }
    setBusy(true);
    const base = `/api/zones/${zoneId}/records`;
    const query = `?providerId=${providerId}`;
    const body: Record<string, unknown> = { type, name, content, ttl, proxied };
    if (priority !== "") body.priority = Number(priority);
    try {
      if (isEdit && record) {
        await apiFetch(`${base}/${record.id}${query}`, { method: "PATCH", body });
      } else {
        await apiFetch(`${base}${query}`, { method: "POST", body });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={isEdit ? "Edit record" : "Create record"}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RecordType)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="@ or subdomain" required />
        <Input label="Content" value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. 192.0.2.1" required />
        <Input
          label="Priority"
          type="number"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          hint="MX / SRV only. Leave blank otherwise."
        />
        <Input
          label="TTL (seconds)"
          type="number"
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          hint="Use 1 for Auto."
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={proxied} onChange={(e) => setProxied(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
          Proxied (Cloudflare orange-cloud)
        </label>
        {error && <p className="text-xs text-red-600 md:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" loading={busy}>{isEdit ? "Save" : "Create"}</Button>
        </div>
      </form>
    </Card>
  );
}

function DeleteButton({
  zoneId,
  providerId,
  recordId,
  onDone,
}: {
  zoneId: string;
  providerId: string;
  recordId: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/zones/${zoneId}/records/${recordId}?providerId=${providerId}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button variant="danger" className="px-2 py-1 text-xs" onClick={remove} loading={busy}>Confirm</Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50"
      onClick={() => setConfirming(true)}
    >
      Delete
    </Button>
  );
}
