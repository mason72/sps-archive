import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // Next's tsconfig leaves JSX untouched ("preserve"), so esbuild would compile
  // components in CLASSIC mode and every render test dies on "React is not
  // defined". Automatic runtime matches what Next itself does.
  esbuild: { jsx: "automatic" },
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
