import { parseGuardLog } from "./guard.ts";
import { buildModel } from "./model.ts";
import { renderPage } from "./page.ts";
import { parseLearned, parseSkills } from "./library.ts";
import { parseProfile } from "./profile.ts";
import {
  FIXED_FILE,
  HISTORY_FILE,
  WEEK_FILE,
  buildSchedule,
} from "./schedule.ts";
import type { Card, CardError, Model } from "./types.ts";

export const LEARNED_FILE = "學到的事.md";
export const SKILL_FOLDER = "技能";

/** 資料夾裡的一份檔案：file 是相對路徑，例如 districts/01-x.md、profile.md */
export type RawFile = Card;

function inFolder(files: RawFile[], folder: string): Card[] {
  const prefix = `${folder}/`;
  return files
    .filter((f) => f.file.startsWith(prefix) && f.file.endsWith(".md"))
    .map((f) => ({ file: f.file.slice(prefix.length), text: f.text }));
}

/** 換行正規化：\r\n 與單獨的 \r 一律換成 \n（Windows／舊 Mac 存的卡片也能讀）。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** 讀進來的每份檔案先正規化換行，後面的解析只需要處理 \n。 */
export function normalizeFiles(files: RawFile[]): RawFile[] {
  return files.map((f) => ({ file: f.file, text: normalizeNewlines(f.text) }));
}

/** 檔案清單 → Model；build-map（bun）與 viewer（瀏覽器）共用，輸出才會一致。 */
export function modelFromFiles(
  files: RawFile[],
  extraErrors: CardError[] = [],
): Model {
  files = normalizeFiles(files);
  const model = buildModel(
    inFolder(files, "districts"),
    inFolder(files, "goals"),
  );
  model.errors.push(...extraErrors);
  const profile = files.find((f) => f.file === "profile.md");
  if (profile) model.strengths = parseProfile(profile.text);
  const guard = files.find((f) => f.file === "guard-log.md");
  if (guard) model.guard = parseGuardLog(guard.text);
  const learned = files.find((f) => f.file === LEARNED_FILE);
  if (learned) model.learned = parseLearned(learned.text);
  const skills = inFolder(files, SKILL_FOLDER);
  if (skills.length > 0) model.skills = parseSkills(skills);
  const text = (name: string) => files.find((f) => f.file === name)?.text;
  const { schedule, errors } = buildSchedule(
    text(FIXED_FILE),
    text(WEEK_FILE),
    text(HISTORY_FILE),
  );
  if (schedule) model.schedule = schedule;
  model.errors.push(...errors);
  return model;
}

export function pageFromFiles(
  files: RawFile[],
  today: Date,
  extraErrors: CardError[] = [],
): string {
  return renderPage(modelFromFiles(files, extraErrors), today);
}

/** 可安全放進 <script> 的 JSON：不會出現 </script、行分隔符或資料區塊標記字樣。 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029")
    .replace(/OASIS-DATA/g, "OASIS\\u002dDATA");
}

/** map.html 資料區塊的內容（一行）：所有卡片原文存成 JS 全域變數（JSON 是合法 JS）。 */
export function cityDataJs(files: RawFile[], errors: CardError[] = []): string {
  const extra =
    errors.length > 0 ? ` window.OASIS_ERRORS = ${scriptJson(errors)};` : "";
  return `window.OASIS_CARDS = ${scriptJson(normalizeFiles(files))};${extra}\n`;
}
