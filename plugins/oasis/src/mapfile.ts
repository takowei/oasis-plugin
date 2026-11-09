import { type DataBlock, evalDataJs } from "./datajs.ts";
import { type RawFile, cityDataJs } from "./fromcards.ts";
import type { CardError } from "./types.ts";

/**
 * 單檔 map.html 的資料區塊。檔內只有這一段會變：
 *
 *   // OASIS-DATA-START（…說明…）
 *   window.OASIS_CARDS = [...];
 *   // OASIS-DATA-END
 *
 * 更新地圖＝把兩行標記之間的內容換掉，標記與其他部分一個字都不動。
 * cityDataJs 會把資料裡「OASIS-DATA」的連字號寫成 JSON 跳脫 u002d，所以標記只會在模板出現一次。
 */
export const DATA_START = "// OASIS-DATA-START";
export const DATA_END = "// OASIS-DATA-END";
const START_LINE = `${DATA_START}（城市資料：更新地圖時只改寫這兩行標記之間的內容）`;

/** viewer 模板放在哪些 skill 的 assets/（SKILL.md 以 ${CLAUDE_SKILL_DIR}/assets/viewer.html 引用）。 */
export const VIEWER_SKILLS = ["oasis-start", "update-map"];
export const viewerPath = (skill: string): string =>
  `skills/${skill}/assets/viewer.html`;

/** 空城的資料行：模板剛複製過去時就是一座空城。 */
export const EMPTY_DATA = cityDataJs([]);

/** 由打包好的瀏覽器 JS 組出 viewer 模板（= 還沒有資料的 map.html）。 */
export function viewerHtml(js: string): string {
  const safe = js.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>綠洲地圖</title></head>
<body>
<script>
${START_LINE}
${EMPTY_DATA}${DATA_END}
</script>
<script>${safe}</script>
</body></html>
`;
}

type Block = { start: number; end: number };

/** 從 i 起往後找第一個換行（\n、\r\n 或單獨的 \r），回傳下一行開頭；找不到回 -1。 */
function nextLineStart(text: string, i: number): number {
  const m = /\r\n?|\n/g;
  m.lastIndex = i;
  const hit = m.exec(text);
  return hit ? hit.index + hit[0].length : -1;
}

/** i 所在那一行的開頭（換行可能是 \n、\r\n 或單獨的 \r）。 */
function lineStartOf(text: string, i: number): number {
  return (
    Math.max(text.lastIndexOf("\n", i - 1), text.lastIndexOf("\r", i - 1)) + 1
  );
}

/** 找出資料區塊在檔案中的位置（START 標記行之後、END 標記行之前）；格式不對就丟錯。 */
function locate(html: string): Block {
  const s = html.indexOf(DATA_START);
  const e = html.lastIndexOf(DATA_END);
  if (s === -1 || e === -1) {
    throw new Error(
      "map.html 找不到資料區塊標記（OASIS-DATA-START／END），請重新複製模板",
    );
  }
  if (html.indexOf(DATA_START, s + 1) !== -1) {
    throw new Error("map.html 有兩個以上的 OASIS-DATA-START 標記");
  }
  if (html.indexOf(DATA_END) !== e) {
    throw new Error("map.html 有兩個以上的 OASIS-DATA-END 標記");
  }
  const start = nextLineStart(html, s);
  const end = lineStartOf(html, e);
  if (start === -1 || start > end || e !== end) {
    throw new Error("map.html 的資料區塊標記順序或換行不對");
  }
  return { start, end };
}

/** 把 map.html（或 viewer 模板）的資料區塊換成這些卡片；區塊外一個字都不改。 */
export function replaceDataBlock(
  html: string,
  files: RawFile[],
  errors: CardError[] = [],
): string {
  const { start, end } = locate(html);
  return html.slice(0, start) + cityDataJs(files, errors) + html.slice(end);
}

/** 取出資料區塊那段 JS 原文（不含標記行）。 */
export function dataBlockJs(html: string): string {
  const { start, end } = locate(html);
  return html.slice(start, end);
}

/** 讀回資料區塊（測試、檢查與 viewer 修補用）：在假的 window 上執行那一段 JS。 */
export function readDataBlock(html: string): DataBlock {
  return evalDataJs(dataBlockJs(html));
}
