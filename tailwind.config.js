/** @type {import('tailwindcss').Config} */

// Brand palette (from the brand image):
//   primary   #1e95d4  deep blue    -> key actions, active states, focus
//   secondary #78cede  medium cyan  -> accents, highlights, charts
//   tertiary  #b1e4e7  light aqua   -> subtle backgrounds, badges
// The `brand` scale is built around those three stops so every existing
// `brand-*` utility picks the palette up. White text is only ever placed on
// brand-600 and darker (>= 4.5:1 contrast); the light stops carry dark text.
const brand = {
  50: "#effafb",
  100: "#dcf2f4",
  200: "#b1e4e7", // tertiary
  300: "#78cede", // secondary
  400: "#46b1dc",
  500: "#1e95d4", // primary
  600: "#1679b0", // primary, accessible depth for white text (4.8:1)
  700: "#135f8a",
  800: "#134f72",
  900: "#12425e",
  950: "#0b2a3e",
};

// Apple-like neutral ramp (lightly cool). Replaces Tailwind's slate so every
// existing slate-* utility becomes the refined neutral set.
const slate = {
  50: "#f5f5f7",
  100: "#eeeef1",
  200: "#e3e3e8",
  300: "#d2d2d7",
  400: "#a1a1a6",
  500: "#6e6e73",
  600: "#515154",
  700: "#3a3a3c",
  800: "#2c2c2e",
  900: "#1c1c1e",
  950: "#111113",
};

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  future: {
    // Hover styles only on devices that can hover: no sticky hover after a tap.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        brand,
        slate,
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          strong: "rgb(var(--color-primary-strong) / <alpha-value>)",
        },
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        tertiary: "rgb(var(--color-tertiary) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--surface-1) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          canvas: "rgb(var(--surface-canvas) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          "system-ui",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          '"SF Mono"',
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        // Layered, low-contrast shadows instead of hard borders.
        xs: "0 1px 2px rgb(0 0 0 / 0.04)",
        sm: "0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.04)",
        card: "0 0 0 1px rgb(0 0 0 / 0.04), 0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px -4px rgb(0 0 0 / 0.06)",
        "card-dark": "0 0 0 1px rgb(255 255 255 / 0.06), 0 1px 2px rgb(0 0 0 / 0.3), 0 4px 16px -4px rgb(0 0 0 / 0.4)",
        pop: "0 0 0 1px rgb(0 0 0 / 0.05), 0 8px 24px -6px rgb(0 0 0 / 0.14), 0 2px 6px rgb(0 0 0 / 0.05)",
        "pop-dark": "0 0 0 1px rgb(255 255 255 / 0.08), 0 12px 32px -8px rgb(0 0 0 / 0.6)",
        button: "0 1px 2px rgb(19 95 138 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.14)",
      },
      transitionTimingFunction: {
        // Strong custom curves (Emil Kowalski): ease-out for enter/exit & press,
        // ease-in-out for on-screen movement, iOS drawer curve for sheets.
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      transitionDuration: {
        120: "120ms",
        160: "160ms",
        250: "250ms",
      },
      keyframes: {
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.96) translateY(-4px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "150% 0" },
          to: { backgroundPosition: "-50% 0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 240ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "fade-in": "fade-in 200ms ease both",
        "pop-in": "pop-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both",
        shimmer: "shimmer 1.4s linear infinite",
        "spin-fast": "spin 0.7s linear infinite",
      },
    },
  },
  plugins: [],
};
