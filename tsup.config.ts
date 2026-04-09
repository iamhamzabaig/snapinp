import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs", "iife"],
  globalName: "SnapINP",
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  splitting: false,
  outExtension({ format }) {
    if (format === "esm") return { js: ".mjs", dts: ".d.mts" };
    if (format === "cjs") return { js: ".cjs", dts: ".d.cts" };
    return { js: ".global.js" };
  },
});
