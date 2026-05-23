import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const isProduction = process.argv.includes("--production");

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: [
    "vscode",
    "better-sqlite3", // Native module — must be external
    "sql.js",         // WASM fallback — must be external (loads its own .wasm file)
  ],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: isProduction,
  treeShaking: true,
  logLevel: "info",
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log("[esbuild] Watching for changes...");
  } else {
    await esbuild.build(config);
    console.log("[esbuild] Build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
