import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query", "i18next", "react-i18next", "i18next-browser-languagedetector"],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/react-router-dom")) {
            return "vendor-router";
          }
          if (id.includes("@supabase/supabase-js") || id.includes("@tanstack/react-query")) {
            return "vendor-data";
          }
          if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) {
            return "vendor-i18n";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("node_modules/recharts")) {
            return "vendor-charts";
          }
          if (id.includes("node_modules/react-markdown")) {
            return "vendor-markdown";
          }
          if (id.includes("node_modules/three")) {
            return "vendor-three";
          }
          if (id.includes("node_modules/psd.js") || id.includes("node_modules/jszip")) {
            return "vendor-thumb";
          }
          if (id.includes("node_modules/@radix-ui")) {
            return "vendor-radix";
          }
          if (id.includes("/src/pages/admin/")) {
            return "route-admin";
          }
          if (id.includes("/src/pages/thumb-tools/") || id.includes("/src/features/tgis-thumb-tools/")) {
            return "route-thumb-tools";
          }
          if (id.includes("/src/pages/public/DiscoverLive") || id.includes("/src/pages/public/IslandPage")) {
            return "route-discovery";
          }
          return undefined;
        },
      },
    },
  },
}));
