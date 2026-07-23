// リポジトリ直下の data/（Python取込が生成する正準JSON）を
// web/public/data/ へコピーする。dev / build の前に実行される。
import { cp, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../data");
const dest = resolve(here, "../public/data");

await mkdir(dest, { recursive: true });
// 生成SQLite(数百MB)は配信JSONではないので除外。将来 httpvfs で使う際は別途扱う。
await cp(src, dest, {
  recursive: true,
  filter: (p) => !p.endsWith(".sqlite"),
});
const files = await readdir(dest);
console.log(`[copy-data] ${src} -> ${dest} : ${files.join(", ")}`);
