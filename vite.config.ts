/// <reference types="vitest/config" />
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const target = process.env.VANNA_API_TARGET ?? 'http://127.0.0.1:8000';
const proxy = {
  '/api': { target, changeOrigin: true },
  '/ws': { target, ws: true },
};
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Mirrors what nginx does in the container, so the app talks to the same
    // same-origin paths in dev and in production. Without this the snapshot
    // fetch 404s against the dev server and the app silently falls back to the
    // simulation, which looks identical until you check which prices you are
    // looking at.
    proxy,
  },
  preview: { proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
