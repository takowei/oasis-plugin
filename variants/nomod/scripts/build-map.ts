import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LEARNED_FILE, SKILL_FOLDER, type RawFile } from "../src/fromcards.ts";
import { TIME_FOLDER } from "../src/schedule.ts";
import { replaceDataBlock, viewerPath } from "../src/mapfile.ts";
import { DEFAULT_DATA_DIR, expandHome } from "../src/paths.ts";
import type { CardError } from "../src/types.ts";

/** 用法：bun build-map.ts [--data-dir <資料夾>]（也接受直接給資料夾） */
function dataDirArg(argv: string[]): string {
  const i = argv.indexOf("--data-dir");
  const raw = i >= 0 ? argv[i + 1] : argv[0];
  return expandHome(raw ?? DEFAULT_DATA_DIR, homedir());
}

const dataDir = dataDirArg(process.argv.slice(2));
const unreadable: CardError[] = [];

function readFolder(sub: string): RawFile[] {
  const dir = join(dataDir, sub);
  if (!existsSync(dir)) return [];
  const files: RawFile[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    try {
      files.push({
        file: `${sub}/${name}`,
        text: readFileSync(join(dir, name), "utf8"),
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      unreadable.push({ file: `${sub}/${name}`, reason: `讀不到：${why}` });
    }
  }
  return files;
}

const files = [
  ...readFolder("districts"),
  ...readFolder("goals"),
  ...readFolder(SKILL_FOLDER),
  ...readFolder(TIME_FOLDER),
];
const profile = join(dataDir, "profile.md");
if (existsSync(profile)) {
  files.push({ file: "profile.md", text: readFileSync(profile, "utf8") });
}
const learned = join(dataDir, LEARNED_FILE);
if (existsSync(learned)) {
  files.push({ file: LEARNED_FILE, text: readFileSync(learned, "utf8") });
}
const guardLog = join(dataDir, "guard-log.md");
if (existsSync(guardLog)) {
  files.push({ file: "guard-log.md", text: readFileSync(guardLog, "utf8") });
}
mkdirSync(dataDir, { recursive: true });
const out = join(dataDir, "map.html");
// 和 Cowork 版同一份單檔 map.html：viewer 模板＋內嵌資料區塊（不再需要 city-data.js）
const template = readFileSync(
  join(import.meta.dir, "..", viewerPath("update-map")),
  "utf8",
);
writeFileSync(out, replaceDataBlock(template, files, unreadable));
process.stdout.write(`${out}\n`);
