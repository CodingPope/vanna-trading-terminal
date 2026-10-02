/// <reference types="vitest/config" />
import path from "path"
import { gzipSync } from "node:zlib"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * Writes what each chunk actually weighs, and what is in it.
 *
 * Budgets without an analysis next to them turn into numbers nobody can act on:
 * the build fails, and the only way to find out why is to bisect imports. This
 * writes both sizes and the modules that account for them, so `yarn budget`
 * can name the asset and this can say what put it there.
 */
function bundleAnalysis(): Plugin {
  return {
    name: 'vanna-bundle-analysis',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).map(asset => {
        const source = asset.type === 'chunk' ? asset.code : asset.source;
        const bytes = Buffer.from(typeof source === 'string' ? source : source);
        const modules = asset.type === 'chunk'
          ? Object.entries(asset.modules)
              .map(([id, module]) => ({
                id: id.replace(/.*\/node_modules\//, 'node_modules/').replace(process.cwd() + '/', ''),
                bytes: module.renderedLength,
              }))
              .sort((a, b) => b.bytes - a.bytes)
              .slice(0, 12)
          : [];
        return {
          file: asset.fileName,
          kind: asset.type,
          entry: asset.type === 'chunk' ? asset.isEntry : false,
          dynamic: asset.type === 'chunk' ? asset.isDynamicEntry : false,
          // Static imports decide what the first route pays for; dynamic ones
          // are what it deliberately does not.
          imports: asset.type === 'chunk' ? asset.imports : [],
          dynamicImports: asset.type === 'chunk' ? asset.dynamicImports : [],
          bytes: bytes.length,
          gzipBytes: gzipSync(bytes).length,
          topModules: modules,
        };
      }).sort((a, b) => b.gzipBytes - a.gzipBytes);

      this.emitFile({
        type: 'asset',
        fileName: 'bundle-analysis.json',
        source: `${JSON.stringify({ generatedAt: new Date().toISOString(), chunks }, null, 2)}\n`,
      });
    },
  };
}

const target = process.env.VANNA_API_TARGET ?? 'http://127.0.0.1:8000';
const proxy = {
  '/api': { target, changeOrigin: true },
  '/ws': { target, ws: true },
};
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), bundleAnalysis()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    /**
     * No manualChunks. The dynamic import boundaries in App.tsx, Dashboard.tsx
     * and LandingPage.tsx already put each visualization library in its own
     * chunk, and Rollup's own splitting keeps the shared graph consistent.
     * Hand-partitioning it was worse on both counts: naming a chunk for React
     * reordered module initialisation across chunk boundaries and React 19 died
     * at startup with "Cannot set properties of undefined (setting 'Activity')",
     * and naming one for a library without its private dependency web left the
     * leftovers in a shared chunk that then imported the library's chunk, so the
     * entry preloaded three.js in order to reach a date formatter.
     *
     * Sizes and the modules behind them are in dist/bundle-analysis.json;
     * limits are in bundle-budget.json and enforced by `yarn budget`.
     */
    chunkSizeWarningLimit: 1200,
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
