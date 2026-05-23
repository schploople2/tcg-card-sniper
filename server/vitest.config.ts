import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the server.
 *
 * The codebase uses TypeScript ESM-style imports with explicit `.js`
 * extensions (e.g. `import { foo } from "./bar.js"`) because tsc compiles
 * to CommonJS at runtime and Node's CommonJS resolver tolerates them.
 *
 * Vitest's esbuild loader does NOT tolerate that by default — it tries to
 * load a literal `./bar.js` file which doesn't exist (the source is `bar.ts`).
 * The plugin below rewrites `.js` imports to `.ts` so tests can resolve.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // Tests are pure — no DB, no network. Don't load .env or start a server.
    globals: false,
    environment: "node",
    // Stub the env vars config.ts validates at import time.
    setupFiles: ["./vitest.setup.ts"],
    // 10s is plenty; if anything takes longer it's a bug.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/services/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
    },
  },
  resolve: {
    // Strip .js extensions from relative imports so vitest can pick up the
    // corresponding .ts source. Mirrors tsconfig's "moduleResolution: node"
    // behavior at runtime.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
});
