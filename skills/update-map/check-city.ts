/**
 * 檢查熱快取 city.md 的上限（開發者在 repo 裡用；update-map skill 收工時照同一套規則手動做）。
 *
 *   bun check-city.ts <資料夾>           只回報（JSON），不改檔
 *   bun check-city.ts <資料夾> --apply   把超出的條目搬到 city/<鍵>.md，並從 city.md 拿掉
 *
 * city.md 不存在就回報 {"exists":false}，不建立任何檔。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CITY_CACHE_FILE,
  CITY_DEEP_DIR,
  appendToDeep,
  checkCityCache,
  groupMovesByDeepFile,
  removeMovedEntries,
} from "../../src/city-cache.ts";
import { DEFAULT_DATA_DIR, expandHome } from "../../src/paths.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dir = expandHome(
  args.find((a) => a !== "--apply") ?? DEFAULT_DATA_DIR,
  homedir(),
);
const hotPath = join(dir, CITY_CACHE_FILE);

if (!existsSync(hotPath)) {
  console.log(JSON.stringify({ exists: false, file: hotPath }));
  process.exit(0);
}

const deepDir = join(dir, CITY_DEEP_DIR);
const deepFiles = existsSync(deepDir)
  ? readdirSync(deepDir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => `${CITY_DEEP_DIR}/${n}`)
  : [];
const text = readFileSync(hotPath, "utf8");
const report = checkCityCache(text, deepFiles);

if (apply && report.moves.length > 0) {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  mkdirSync(deepDir, { recursive: true });
  for (const [file, moves] of groupMovesByDeepFile(report.moves)) {
    const full = join(dir, file);
    const old = existsSync(full) ? readFileSync(full, "utf8") : undefined;
    const first = moves[0]!.entry;
    writeFileSync(
      full,
      appendToDeep(
        old,
        first.key,
        moves.map((m) => m.entry),
        date,
      ),
    );
  }
  // 先寫深層、再改熱快取：中途失敗頂多重複，不會遺失條目
  writeFileSync(hotPath, removeMovedEntries(text, report.moves));
}

console.log(
  JSON.stringify(
    {
      exists: true,
      applied: apply && report.moves.length > 0,
      lines: report.lines,
      chars: report.chars,
      limits: report.limits,
      ok: report.ok,
      stillOver: report.stillOver,
      after: report.after,
      moves: report.moves.map((m) => ({
        line: m.entry.line,
        key: m.entry.key,
        text: m.entry.text,
        deepFile: m.entry.deepFile,
        deepExists: m.deepExists,
      })),
    },
    null,
    2,
  ),
);
