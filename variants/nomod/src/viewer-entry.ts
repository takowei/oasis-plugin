import { evalDataJs } from "./datajs.ts";
import { type RawFile, pageFromFiles } from "./fromcards.ts";
import type { CardError } from "./types.ts";

declare global {
  interface Window {
    OASIS_CARDS?: RawFile[];
    OASIS_ERRORS?: CardError[];
  }
}

const MISSING =
  "<p style='font:16px sans-serif;padding:24px'>map.html 裡的城市資料壞掉了，讀不出來。請回到 Claude 說「更新地圖」重新產生。</p>";

/** 瀏覽器入口：讀 map.html 內嵌資料區塊的卡片，畫出和 build-map 同一份頁面。 */
/**
 * 資料區塊沒載入（多半是手寫資料行時字串裡留了真的換行或 CR，整段語法錯誤）：
 * 讀第一個 <script> 的原文，修補字串內的換行後再執行一次。
 */
function recover(): { files?: RawFile[]; errors: CardError[] } {
  try {
    const { cards, errors } = evalDataJs(document.scripts[0]?.text ?? "");
    return cards.length > 0 ? { files: cards, errors } : { errors: [] };
  } catch {
    return { errors: [] };
  }
}

function main(): void {
  let files = window.OASIS_CARDS;
  let errors = Array.isArray(window.OASIS_ERRORS) ? window.OASIS_ERRORS : [];
  if (!Array.isArray(files)) ({ files, errors } = recover());
  const html = Array.isArray(files)
    ? pageFromFiles(files, new Date(), errors)
    : MISSING;
  document.open();
  document.write(html);
  document.close();
}

main();
