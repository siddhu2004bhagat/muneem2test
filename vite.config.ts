import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: true, // Allow access from LAN
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    hmr: {
      overlay: false,
      timeout: 10000,
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
    allowedHosts: [
      'localhost',
      '.local',
      '.ngrok-free.dev',
      '.ngrok.io',
      '.ngrok.app',
      '192.168.29.253',
      'Abduls-MacBook-Air-2.local',
      'annalisa-actinodrome-pablo.ngrok-free.dev'
    ],
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  assetsInclude: ["**/*.md"],
  // Environment variables (can be overridden by .env file)
  define: {
    'import.meta.env.VITE_PADDLE_OCR_URL': JSON.stringify(
      process.env.VITE_PADDLE_OCR_URL || 'http://localhost:9000/recognize'
    ),
  },
}));
