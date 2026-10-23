// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Lovable's own builds pin LOVABLE_NITRO_PRESET (Cloudflare). Everywhere else,
  // including Render, serve the Nitro node server so SSR and server functions run.
  nitro: {
    preset: "node-server",
  },
  vite: {
    build: {
      modulePreload: {
        resolveDependencies(_filename, deps) {
          // The subwoofer tab is a separate route chunk. Keep it off the
          // initial HTML preload list until that tab is opened.
          return deps.filter((dep) => !dep.includes("SubwooferNoise"));
        },
      },
    },
  },
});
