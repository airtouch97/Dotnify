import type { SVGProps } from "react";

/**
 * Minimal SF-Symbols-like stroke icon set (1.75 stroke, rounded joins).
 * Icons are decorative by default (aria-hidden); pair with visible text or an aria-label.
 */
export type IconName =
  | "home"
  | "globe"
  | "server"
  | "network"
  | "plug"
  | "sparkles"
  | "more"
  | "logout"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "plus"
  | "search"
  | "check"
  | "x"
  | "copy"
  | "refresh"
  | "trash"
  | "edit"
  | "sun"
  | "moon"
  | "languages"
  | "user"
  | "download"
  | "upload"
  | "key"
  | "alert"
  | "history";

const PATHS: Record<IconName, JSX.Element> = {
  history: (
    <>
      <path d="M4.25 12a7.75 7.75 0 1 0 2.27-5.48L4.25 8.75" />
      <path d="M4.25 4.5v4.25H8.5M12 8v4.25l2.75 1.75" />
    </>
  ),
  home: <path d="M3.5 10.5 12 3.75l8.5 6.75V19a1.75 1.75 0 0 1-1.75 1.75H15v-6h-6v6H5.25A1.75 1.75 0 0 1 3.5 19v-8.5Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.25 12h17.5M12 3.25c2.3 2.4 3.5 5.3 3.5 8.75S14.3 18.35 12 20.75C9.7 18.35 8.5 15.45 8.5 12S9.7 5.65 12 3.25Z" />
    </>
  ),
  server: (
    <>
      <rect x="3.75" y="4" width="16.5" height="7" rx="2" />
      <rect x="3.75" y="13" width="16.5" height="7" rx="2" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5.5M11 16.5h5.5" />
    </>
  ),
  network: (
    <>
      <rect x="9" y="3.5" width="6" height="5" rx="1.25" />
      <rect x="3.5" y="15.5" width="6" height="5" rx="1.25" />
      <rect x="14.5" y="15.5" width="6" height="5" rx="1.25" />
      <path d="M12 8.5v3.5M6.5 15.5V13.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v2" />
    </>
  ),
  plug: <path d="M9 3.75v4.5M15 3.75v4.5M6.75 8.25h10.5v3a5.25 5.25 0 0 1-10.5 0v-3ZM12 16.5v3.75" />,
  sparkles: (
    <>
      <path d="M10 3.75 11.6 8.4 16.25 10 11.6 11.6 10 16.25 8.4 11.6 3.75 10 8.4 8.4 10 3.75Z" />
      <path d="M17.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
    </>
  ),
  logout: <path d="M14.25 4.25h3A1.75 1.75 0 0 1 19 6v12a1.75 1.75 0 0 1-1.75 1.75h-3M10 16.25 5.75 12 10 7.75M5.75 12h9" />,
  "chevron-right": <path d="m9.5 5.75 6.25 6.25-6.25 6.25" />,
  "chevron-left": <path d="M14.5 5.75 8.25 12l6.25 6.25" />,
  "chevron-down": <path d="m5.75 9.5 6.25 6.25 6.25-6.25" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.25" />
      <path d="m15.75 15.75 4 4" />
    </>
  ),
  check: <path d="m5.25 12.5 4.25 4.25 9.25-9.5" />,
  x: <path d="M6.25 6.25l11.5 11.5M17.75 6.25 6.25 17.75" />,
  copy: (
    <>
      <rect x="8.25" y="8.25" width="11.5" height="11.5" rx="2" />
      <path d="M15.75 8.25V6A1.75 1.75 0 0 0 14 4.25H6A1.75 1.75 0 0 0 4.25 6v8A1.75 1.75 0 0 0 6 15.75h2.25" />
    </>
  ),
  refresh: <path d="M19.25 12a7.25 7.25 0 1 1-2.1-5.1M19.25 4.75v4.5h-4.5" />,
  trash: <path d="M4.75 6.75h14.5M9.75 6.75V5a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.75M6.5 6.75l.8 12a1.75 1.75 0 0 0 1.75 1.5h5.9a1.75 1.75 0 0 0 1.75-1.5l.8-12" />,
  edit: <path d="M4.75 19.25h4L19 9a2.83 2.83 0 0 0-4-4L4.75 15.25v4ZM13.5 6.5l4 4" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 3v1.75M12 19.25V21M3 12h1.75M19.25 12H21M5.64 5.64l1.24 1.24M17.12 17.12l1.24 1.24M5.64 18.36l1.24-1.24M17.12 6.88l1.24-1.24" />
    </>
  ),
  moon: <path d="M19.5 14.6A7.75 7.75 0 0 1 9.4 4.5a7.75 7.75 0 1 0 10.1 10.1Z" />,
  languages: <path d="M4 5.5h9M8.5 4v1.5M11 5.5c-.9 3.6-3.2 6.4-6.5 8M6.5 8.5c1.1 2 2.9 3.6 5 4.5M12.5 20l3.75-9 3.75 9M13.75 17h5" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.75 19.75c1.2-3.3 3.9-5 7.25-5s6.05 1.7 7.25 5" />
    </>
  ),
  download: <path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14" />,
  upload: <path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9M5 19.5h14" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.35-8.35M16.5 6.5l2.25 2.25M14.25 8.75l2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.5 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 16.75h.01" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className = "", ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
