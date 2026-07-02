import type { ProviderType } from "@/lib/types";
import { CloudflareLogo, HuaweiCloudLogo, DnspodLogo } from "@/lib/provider-logos";

const LABELS: Record<ProviderType, string> = {
  cloudflare: "Cloudflare",
  huawei: "Huawei Cloud",
  dnspod: "DNSPod",
};

export function ProviderLogo({ type, size = "sm" }: { type: ProviderType; size?: "sm" | "md" }) {
  const label = LABELS[type] ?? type;
  const dim = size === "md" ? "h-7 w-7" : "h-5 w-5";

  const svg = (() => {
    switch (type) {
      case "cloudflare": return <CloudflareLogo />;
      case "huawei": return <HuaweiCloudLogo />;
      case "dnspod": return <DnspodLogo />;
      default: return null;
    }
  })();

  if (svg) {
    return (
      <span title={label} className={`inline-flex ${dim} items-center`}>
        {svg}
      </span>
    );
  }

  return (
    <span
      title={label}
      className={`inline-flex ${dim} items-center justify-center rounded font-bold uppercase text-white bg-slate-400`}
    >
      ?
    </span>
  );
}
