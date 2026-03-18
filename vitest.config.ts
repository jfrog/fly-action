import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.spec.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/integration-tests/**"],
    },
  },
});
