/**
 * Known Vercel edge addresses / CNAME targets, used to hide Vercel-hosted
 * records from the "IP usage" view (they are not your own servers).
 *
 * Sources: Vercel docs (76.76.21.21 general-purpose A record; newer projects get
 * addresses from the 216.198.79.0/24 and 64.29.17.0/24 anycast pools) and the
 * legacy 66.33.60.0/24 edge range. Whole /24s are treated as Vercel.
 */
const VERCEL_V4_PREFIXES = ["76.76.21.", "216.198.79.", "64.29.17.", "66.33.60."];

/** CNAME targets such as cname.vercel-dns.com, cname.vercel-dns-0.com, xxx.vercel-dns-017.com */
const VERCEL_CNAME_RE = /(^|\.)vercel-dns(-\d+)?\.com\.?$/i;

export function isVercelIp(ip: string): boolean {
  const v = ip.trim();
  return VERCEL_V4_PREFIXES.some((p) => v.startsWith(p));
}

export function isVercelCname(target: string): boolean {
  return VERCEL_CNAME_RE.test(target.trim());
}
