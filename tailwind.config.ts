import type { Config } from "tailwindcss";

/**
 * SEVA MARKET INDIA — design tokens
 * - brand : saffron/orange (primary actions, energy, "seva" warmth)
 * - navy  : deep trustworthy blue (text, header accents, footer)
 * Mobile-first: every component is designed at 360px first, then scaled up.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#FFF6EE",
          100: "#FFEAD5",
          200: "#FFD1A8",
          300: "#FFB070",
          400: "#FF8833",
          500: "#FB6C0E",
          600: "#EC5308",
          700: "#C23E07",
          800: "#97330D",
          900: "#7A2D0E",
          950: "#431407",
        },
        navy: {
          50: "#F2F6FC",
          100: "#E2EAF7",
          200: "#C2D5EE",
          300: "#93B6E0",
          400: "#5D8FCB",
          500: "#3B6FB2",
          600: "#2C578F",
          700: "#254875",
          800: "#213E62",
          900: "#1E3553",
          950: "#14223A",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "sans-serif"],
        display: ["var(--font-poppins)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 16px rgba(16, 24, 40, 0.08)",
        lifted: "0 8px 30px rgba(16, 24, 40, 0.12)",
      },
      maxWidth: {
        "8xl": "90rem",
      },
    },
  },
  plugins: [],
};

export default config;
