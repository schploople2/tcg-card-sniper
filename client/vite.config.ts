import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy /api requests to the Express server in dev
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // `vite preview` runs in prod on Railway. It rejects unknown Host
  // headers by default — allow Railway's *.up.railway.app domain.
  preview: {
    host: true,
    allowedHosts: [".up.railway.app"],
  },
});
