import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0e1a",
          card: "#111827",
          elev: "#1a2235",
        },
        ink: {
          DEFAULT: "#e5e7eb",
          dim: "#9ca3af",
          faint: "#6b7280",
        },
        accent: {
          up: "#10b981",
          down: "#ef4444",
          blue: "#3b82f6",
          amber: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
