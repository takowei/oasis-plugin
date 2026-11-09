import type { Model, Strength } from "./types.ts";

/**
 * 解析 profile.md：每個 `## 強項` 一條，底下的 `- 來源事件` 各算一件。
 * 沒有來源的標題照列（來源事件 0 件），其他格式的行一律忽略。
 */
export function parseProfile(text: string): Strength[] {
  const strengths: Strength[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      strengths.push({ name: (heading[1] as string).trim(), sources: [] });
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    const last = strengths[strengths.length - 1];
    if (item && last) last.sources.push((item[1] as string).trim());
  }
  return strengths;
}

/** 沒有任何目標與街區：顯示空城（沙漠＋水池＋引導）。 */
export function isEmptyCity(model: Model): boolean {
  return model.goals.length === 0 && model.districts.length === 0;
}

export const EMPTY_HINT = "跟 Claude 說「開局」，開始找你的綠洲";
