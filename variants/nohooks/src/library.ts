import { splitFrontmatter } from "./parse.ts";
import type { Card, LearnedRule, SkillEntry } from "./types.ts";

const FIELD = /^[-*]\s*(日期|起因|怎麼用)\s*[：:]\s*(.*)$/;

/**
 * 解析 學到的事.md：每個 `## 一句話規則` 一條，底下 `- 日期：`、`- 起因：`、`- 怎麼用：`。
 * 標題以外、也不是這三個欄位的行一律忽略；缺的欄位是空字串。
 */
export function parseLearned(text: string): LearnedRule[] {
  const rules: LearnedRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      rules.push({
        rule: (heading[1] as string).trim(),
        date: "",
        cause: "",
        use: "",
      });
      continue;
    }
    const field = FIELD.exec(line);
    const last = rules[rules.length - 1];
    if (!field || !last) continue;
    const value = (field[2] as string).trim();
    if (field[1] === "日期") last.date = value;
    else if (field[1] === "起因") last.cause = value;
    else last.use = value;
  }
  return rules;
}

/** 技能/*.md 的索引：name、when 來自 frontmatter；讀不出來就用檔名、when 留空。 */
export function parseSkills(cards: Card[]): SkillEntry[] {
  return cards.map((c) => {
    const fallback = c.file.replace(/\.md$/, "");
    const parsed = splitFrontmatter(c.text);
    if (!parsed.ok) return { name: fallback, when: "" };
    const { name, when } = parsed.value.fields;
    return { name: name?.trim() || fallback, when: when?.trim() ?? "" };
  });
}
