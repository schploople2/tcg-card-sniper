import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Pokémon-inspired accent colours
        "poke-yellow": "#F5C518",
        "poke-red": "#E63946",
        // Background ramp
        "navy-950": "#0a0f1e",
        "navy-900": "#0f172a",
        "navy-800": "#1e293b",
        "navy-700": "#334155",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      keyframes: {
        "pulse-urgent": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "pulse-urgent": "pulse-urgent 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
