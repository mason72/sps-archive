import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // Next's tsconfig leaves JSX untouched ("preserve"), so the transform would
  // compile components in CLASSIC mode (or, on Vite 8, refuse to parse them)
  // and every render test dies. Automatic runtime matches what Next itself
  // does. Vite 8 compiles with oxc and IGNORES an `esbuild` key, so the
  // setting lives here (vitest 4 upgrade, 2026-11-15).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
