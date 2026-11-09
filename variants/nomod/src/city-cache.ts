/**
 * 兩層記憶的上限檢查（規格見 docs/city-data-spec.md）。
 *
 * 熱快取＝`<data_dir>/city.md`：每條一行（`- [鍵] 內容`），只放目標／建築／待辦的指標。
 * 深層＝`<data_dir>/city/<鍵>.md`：每個目標或建築一檔，放細節與從熱快取搬來的舊條目。
 * 這裡只有純函式：輸入檔案文字、輸出報告與新文字；讀寫檔由呼叫端（update-map skill）做。
 */

export interface CityCacheLimits {
  /** 行數上限（含標題與空行；結尾換行不算一行） */
  maxLines: number;
  /** 字數上限：以 Unicode 字元（code point）計，含換行；中文一字算 1 */
  maxChars: number;
}

/** 預設上限：100 行、4000 字（UTF-8 約 12KB，遠低於 auto memory 的 200 行／25KB） */
export const CITY_CACHE_LIMITS: CityCacheLimits = {
  maxLines: 100,
  maxChars: 4000,
};

export const CITY_CACHE_FILE = "city.md";
export const CITY_DEEP_DIR = "city";
/** 沒寫 `[鍵]` 的條目搬到這裡 */
export const UNSORTED_KEY = "未分類";

export interface CityEntry {
  /** 在 city.md 的行號（1 起算） */
  line: number;
  /** 所屬的 `## 區段` 標題；沒有就是空字串 */
  section: string;
  /** `[鍵]` 的內容；沒寫就是 UNSORTED_KEY */
  key: string;
  /** 整行原文（不含換行） */
  text: string;
  /** 對應的深層檔相對路徑，例如 `city/咖啡店打工.md` */
  deepFile: string;
}

export interface CityMove {
  entry: CityEntry;
  /** 深層檔已存在嗎；false＝呼叫端要先建立 */
  deepExists: boolean;
}

export interface CityCacheReport {
  lines: number;
  chars: number;
  limits: CityCacheLimits;
  /** 沒超過上限 */
  ok: boolean;
  /** 依建議順序要搬到深層的條目（從檔尾往前，搬到剛好不超過為止） */
  moves: CityMove[];
  /** 搬完所有條目仍超過（標題或非條目文字太多），要人工精簡 */
  stillOver: boolean;
  /** 搬完後的行數與字數 */
  after: { lines: number; chars: number };
}

const ENTRY = /^\s*[-*]\s+(.*)$/;
const KEY = /^\[([^\]]+)\]/;
/** 指標只認 city/ 底下一層的檔名（不含子資料夾） */
const POINTER = /(?:^|[\s→(（])(city\/[^\s)）/\\]+\.md)(?=$|[\s)）])/;
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 行數：結尾的換行不算多一行；空字串是 0 行。 */
export function countLines(text: string): number {
  if (text === "") return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/** 字數：Unicode 字元數（中文、emoji 各算 1），含換行。 */
export function countChars(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** 把鍵變成可當檔名的字：去掉路徑與 Windows 不允許的符號，空白換成 -，保留中文。 */
export function deepFileName(key: string): string {
  const cleaned = key
    .trim()
    .replace(BAD_NAME, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "");
  return `${CITY_DEEP_DIR}/${cleaned || UNSORTED_KEY}.md`;
}

/** 解析 city.md 的條目（`- ` 或 `* ` 開頭的行）；標題、空行、其他文字不是條目。 */
export function parseCityEntries(text: string): CityEntry[] {
  const entries: CityEntry[] = [];
  let section = "";
  const rows = text.split("\n");
  rows.forEach((raw, i) => {
    const row = raw.replace(/\r$/, "");
    const heading = /^##\s+(.+)$/.exec(row.trim());
    if (heading) {
      section = (heading[1] as string).trim();
      return;
    }
    const m = ENTRY.exec(row);
    if (!m) return;
    const body = (m[1] as string).trim();
    const keyMatch = KEY.exec(body);
    const key = keyMatch ? (keyMatch[1] as string).trim() : UNSORTED_KEY;
    const pointer = POINTER.exec(body);
    // 指標只接受 city/ 底下、不含 .. 的路徑，避免搬到資料夾外
    const pointed = pointer ? (pointer[1] as string) : "";
    const deepFile =
      pointed && !pointed.includes("..") && !pointed.includes("\\")
        ? pointed
        : deepFileName(key);
    entries.push({ line: i + 1, section, key, text: row, deepFile });
  });
  return entries;
}

/**
 * 檢查 city.md 是否超過上限；超過就從檔尾往前挑條目，直到行數與字數都不超過。
 * `deepFiles` 是 `<data_dir>` 下已存在的深層檔相對路徑（例如 `city/income.md`）。
 */
export function checkCityCache(
  text: string,
  deepFiles: readonly string[],
  limits: CityCacheLimits = CITY_CACHE_LIMITS,
): CityCacheReport {
  const lines = countLines(text);
  const chars = countChars(text);
  const over = (l: number, c: number) =>
    l > limits.maxLines || c > limits.maxChars;
  const existing = new Set(deepFiles);
  const moves: CityMove[] = [];
  let l = lines;
  let c = chars;
  const entries = parseCityEntries(text);
  for (let i = entries.length - 1; i >= 0 && over(l, c); i--) {
    const entry = entries[i] as CityEntry;
    moves.push({ entry, deepExists: existing.has(entry.deepFile) });
    l -= 1;
    c -= countChars(entry.text) + 1;
  }
  return {
    lines,
    chars,
    limits,
    ok: !over(lines, chars),
    moves,
    stillOver: over(l, c),
    after: { lines: l, chars: c },
  };
}

/** 從 city.md 拿掉要搬走的條目行（只拿掉那幾行，其他原樣保留）。 */
export function removeMovedEntries(
  text: string,
  moves: readonly CityMove[],
): string {
  const drop = new Set(moves.map((m) => m.entry.line));
  return text
    .split("\n")
    .filter((_, i) => !drop.has(i + 1))
    .join("\n");
}

/**
 * 把搬來的條目附加到深層檔；`existing` 為 undefined＝檔案不存在，產生新檔（開頭 `# 鍵`）。
 * 條目依原本在 city.md 的順序寫入，放在 `## 從熱快取搬來（日期）` 底下。
 */
export function appendToDeep(
  existing: string | undefined,
  key: string,
  entries: readonly CityEntry[],
  date: string,
): string {
  const lines = [...entries]
    .sort((a, b) => a.line - b.line)
    .map((e) => e.text.trim());
  const block = `## 從熱快取搬來（${date}）\n${lines.join("\n")}\n`;
  if (existing === undefined || existing.trim() === "") {
    return `# ${key}\n\n${block}`;
  }
  const base = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}\n${block}`;
}

/** 依深層檔分組，方便一檔寫一次。 */
export function groupMovesByDeepFile(
  moves: readonly CityMove[],
): Map<string, CityMove[]> {
  const out = new Map<string, CityMove[]>();
  for (const m of moves) {
    const list = out.get(m.entry.deepFile) ?? [];
    list.push(m);
    out.set(m.entry.deepFile, list);
  }
  return out;
}
