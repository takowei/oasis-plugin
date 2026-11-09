import { type RawFile, normalizeFiles } from "./fromcards.ts";
import type { CardError } from "./types.ts";

/** 資料區塊 JS 的修補與執行；mapfile（bun）與 viewer（瀏覽器）共用。這裡不放資料區塊標記字樣。 */

/**
 * 修補手寫資料行裡的換行：雙引號字串裡出現真的換行（\r\n、\r、\n）時，
 * 換成 JSON 跳脫 \n；字串外的換行原樣保留（在 JS 裡只是空白）。
 * 手寫資料行時漏跳脫 CR 會讓整段 JS 語法錯誤、地圖整張讀不出來，這裡讓它仍讀得回來。
 */
export function repairDataJs(js: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < js.length; i++) {
    const c = js[i] as string;
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    if (c === "\\") {
      out += c + (js[i + 1] ?? "");
      i++;
    } else if (c === '"') {
      inString = false;
      out += c;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && js[i + 1] === "\n") i++;
      out += "\\n";
    } else {
      out += c;
    }
  }
  return out;
}

export type DataBlock = { cards: RawFile[]; errors: CardError[] };

/** 執行一段資料區塊 JS（在假的 window 上），換行先修補、卡片原文換行先正規化。 */
export function evalDataJs(js: string): DataBlock {
  const win: { OASIS_CARDS?: unknown; OASIS_ERRORS?: unknown } = {};
  new Function("window", repairDataJs(js))(win);
  const cards = Array.isArray(win.OASIS_CARDS)
    ? normalizeFiles(win.OASIS_CARDS as RawFile[])
    : [];
  const errors = Array.isArray(win.OASIS_ERRORS)
    ? (win.OASIS_ERRORS as CardError[])
    : [];
  return { cards, errors };
}
