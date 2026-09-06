import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = (await readFile(resolve(projectRoot, "src/userscript.meta.txt"), "utf8")).trimEnd();
const outputDirectory = resolve(projectRoot, "dist");
const outputFile = resolve(outputDirectory, "BilibiliPrecisionSearch.user.js");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(projectRoot, "src/main.js")],
  outfile: outputFile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome111", "firefox113", "edge111"],
  charset: "utf8",
  legalComments: "none",
  banner: { js: `${metadata}\n` },
  minify: false,
  sourcemap: false,
  logLevel: "info",
});
