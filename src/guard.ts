import type { GuardEvent, GuardLog } from "./types.ts";

/** 面板上顯示的最近警報數 */
export const RECENT_ALERTS = 5;

const LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})｜([^｜]+)｜(.+)$/;

/**
 * 解析 guard-log.md（守衛 hook 追加的日誌）：
 * 每行 `- 日期 時間｜規則｜摘要`，其他行一律忽略。最近的排在前面。
 */
export function parseGuardLog(text: string): GuardLog {
  const events: GuardEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (m) {
      events.push({
        when: m[1] as string,
        rule: (m[2] as string).trim(),
        summary: (m[3] as string).trim(),
      });
    }
  }
  return {
    total: events.length,
    recent: events.slice(-RECENT_ALERTS).reverse(),
  };
}
