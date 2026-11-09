import type { CardError } from "./types.ts";

/** 時間/ 資料夾與兩個檔名（oasis-time 寫檔、viewer 與 Pane 讀檔共用）。 */
export const TIME_FOLDER = "時間";
export const FIXED_FILE = `${TIME_FOLDER}/固定行程.md`;
export const WEEK_FILE = `${TIME_FOLDER}/本週.md`;
export const HISTORY_FILE = `${TIME_FOLDER}/歷史.md`;

export const DAY_NAMES = [
  "週一",
  "週二",
  "週三",
  "週四",
  "週五",
  "週六",
  "週日",
];
const DAY_ALIAS: Record<string, number[]> = {
  週一: [0],
  週二: [1],
  週三: [2],
  週四: [3],
  週五: [4],
  週六: [5],
  週日: [6],
  週天: [6],
  每天: [0, 1, 2, 3, 4, 5, 6],
  平日: [0, 1, 2, 3, 4],
  週末: [5, 6],
};

export const DAY_MINUTES = 24 * 60;

/** 一筆固定行程；start／end 是當天 0 點起算的分鐘，end <= start 表示跨午夜。 */
export interface FixedBlock {
  days: number[];
  start: number;
  end: number;
  name: string;
}

/** 做了｜還沒｜延後｜刪掉 */
export type TaskStatus = "done" | "todo" | "moved" | "dropped";

export interface PlanTask {
  status: TaskStatus;
  /** 當天幾點開始（分鐘）；沒寫時間就是 undefined */
  time?: number;
  text: string;
  /** 預計幾分鐘（`（30 分）`） */
  minutes?: number;
  /** `@ 檔名`：連到的建築 */
  file?: string;
  /** 行尾有 `（太大塊）`：下次滾動調整時拆小 */
  big?: boolean;
}

export interface Schedule {
  fixed: FixedBlock[];
  /** 本週起始日 YYYY-MM-DD（`# 本週（2026-11-09 起）`） */
  weekStart?: string;
  /** 長度 7，週一在前 */
  week: PlanTask[][];
  /** 「## 實際能做」底下的結算行 */
  settled: string[];
  /** 「## 實際能做」底下的 `- 容量：每週 N 塊`；沒寫就是 undefined */
  capacity?: number;
  /** 「## 待排」底下還沒拆成小塊的事 */
  inbox: InboxItem[];
  /** 截止日（`- 截止 11/24 名稱`，寫在固定行程.md 或本週.md 的「## 截止日」） */
  deadlines: Deadline[];
  /** 歷史.md：過去每週排幾塊、做幾塊 */
  history: HistoryItem[];
}

export interface InboxItem {
  text: string;
  /** MM/DD */
  due?: string;
}
export interface Deadline {
  /** YYYY-MM-DD */
  date: string;
  text: string;
}
export interface HistoryItem {
  /** 例如 11/02 起 */
  label: string;
  planned: number;
  done: number;
  /** 延到本週以外的塊數（算完成率的分母用；舊格式沒有就是 0） */
  postponed?: number;
}

/** 一天裡的一段：固定行程（含跨午夜被切開的兩半）。 */
export interface Segment {
  start: number;
  end: number;
  name: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function toMinutes(h: string, m: string): number | undefined {
  const hh = Number(h);
  const mm = Number(m);
  if (mm > 59 || hh > 24 || (hh === 24 && mm > 0)) return undefined;
  return hh * 60 + mm;
}

const DEADLINE_LINE =
  /^[-*]\s*截止\s+(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2}))\s+(.+)$/;

/** `- 截止 11/24 名稱`；沒寫年份就用 year（跨年時月份小很多的算明年）。 */
export function parseDeadline(
  line: string,
  year: number,
  startMonth = 1,
): Deadline | undefined {
  const m = DEADLINE_LINE.exec(line);
  if (!m) return undefined;
  const month = Number(m[2] ?? m[4]);
  const day = Number(m[3] ?? m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const y = m[1] ? Number(m[1]) : month < startMonth - 6 ? year + 1 : year;
  return {
    date: `${y}-${pad(month)}-${pad(day)}`,
    text: (m[6] as string).trim(),
  };
}

const FIXED_LINE =
  /^[-*]\s*(週[一二三四五六日天]|每天|平日|週末)\s+(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})\s+(.+)$/;

/** 解析 固定行程.md；讀不懂的清單行進 errors，其他行（標題、空行、說明）略過。 */
export function parseFixed(
  text: string,
  year = new Date().getFullYear(),
): {
  blocks: FixedBlock[];
  deadlines: Deadline[];
  errors: CardError[];
} {
  const blocks: FixedBlock[] = [];
  const deadlines: Deadline[] = [];
  const errors: CardError[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!/^[-*]\s/.test(line)) return;
    const due = parseDeadline(line, year);
    if (due) {
      deadlines.push(due);
      return;
    }
    const m = FIXED_LINE.exec(line);
    const start = m && toMinutes(m[2] as string, m[3] as string);
    const end = m && toMinutes(m[4] as string, m[5] as string);
    if (!m || start === undefined || end === undefined || start === end) {
      errors.push({
        file: FIXED_FILE,
        reason: `第 ${i + 1} 行讀不懂（要寫「- 週一 08:10-12:00 名稱」）：${line.slice(0, 40)}`,
      });
      return;
    }
    blocks.push({
      days: DAY_ALIAS[m[1] as string] as number[],
      start,
      end,
      name: (m[6] as string).trim(),
    });
  });
  return { blocks, deadlines, errors };
}

const STATUS_MARK: Record<string, TaskStatus> = {
  x: "done",
  X: "done",
  " ": "todo",
  ">": "moved",
  "-": "dropped",
};
const TASK_LINE = /^[-*]\s*\[([xX >-])\]\s*(.*)$/;
const TIME_PREFIX = /^(\d{1,2}):(\d{2})\s+(.*)$/;
const MINUTES_SUFFIX = /[（(]\s*(\d+)\s*分\s*[）)]/;
const BIG_SUFFIX = /[（(]\s*太大塊\s*[）)]/;
const CAPACITY_LINE = /^容量\s*[：:]\s*每週\s*(\d+)\s*塊/;
const FILE_SUFFIX = /\s*[@＠]\s*(\S+)\s*$/;

function parseTask(status: TaskStatus, body: string): PlanTask | undefined {
  let rest = body.trim();
  const task: PlanTask = { status, text: "" };
  const file = FILE_SUFFIX.exec(rest);
  if (file) {
    task.file = (file[1] as string).replace(/\.md$/, "");
    rest = rest.slice(0, file.index).trim();
  }
  const time = TIME_PREFIX.exec(rest);
  if (time) {
    const t = toMinutes(time[1] as string, time[2] as string);
    if (t === undefined || t >= DAY_MINUTES) return undefined;
    task.time = t;
    rest = (time[3] as string).trim();
  }
  const mins = MINUTES_SUFFIX.exec(rest);
  if (mins) {
    task.minutes = Number(mins[1]);
    rest = rest.replace(MINUTES_SUFFIX, "").trim();
  }
  if (BIG_SUFFIX.test(rest)) {
    task.big = true;
    rest = rest.replace(BIG_SUFFIX, "").trim();
  }
  if (status === "moved" || status === "dropped") {
    rest = rest.replace(/^(延後|刪掉)\s*[：:]\s*/, "");
  }
  if (rest === "") return undefined;
  task.text = rest;
  return task;
}

const DAY_HEADING = /^##\s*(週[一二三四五六日天])/;
const WEEK_START = /^#\s.*?(\d{4}-\d{2}-\d{2})/;

/** 解析 本週.md：`## 週一 11/09` 底下的核取清單，`## 實際能做` 底下是結算。 */
export function parseWeek(text: string): {
  weekStart?: string;
  week: PlanTask[][];
  settled: string[];
  capacity?: number;
  inbox: InboxItem[];
  deadlines: Deadline[];
  errors: CardError[];
} {
  const week: PlanTask[][] = DAY_NAMES.map(() => []);
  const settled: string[] = [];
  const errors: CardError[] = [];
  let weekStart: string | undefined;
  let capacity: number | undefined;
  const inbox: InboxItem[] = [];
  const dueLines: { line: string; at: number }[] = [];
  let section: "none" | "settled" | "inbox" | "due" | number = "none";
  const bad = (i: number, line: string, why: string) =>
    errors.push({
      file: WEEK_FILE,
      reason: `第 ${i + 1} 行${why}：${line.slice(0, 40)}`,
    });
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    const start = WEEK_START.exec(line);
    if (start && !line.startsWith("##")) weekStart = start[1];
    if (line.startsWith("##")) {
      const day = DAY_HEADING.exec(line);
      if (day) section = DAY_NAMES.indexOf(day[1] as string);
      else if (/^##\s*實際能做/.test(line)) section = "settled";
      else if (/^##\s*待排/.test(line)) section = "inbox";
      else if (/^##\s*截止日/.test(line)) section = "due";
      else {
        section = "none";
        bad(i, line, "標題讀不懂");
      }
      return;
    }
    if (!/^[-*]\s/.test(line)) return;
    if (section === "settled") {
      const body = line.replace(/^[-*]\s*/, "");
      const cap = CAPACITY_LINE.exec(body);
      if (cap) capacity = Number(cap[1]);
      else settled.push(body);
      return;
    }
    if (section === "inbox") {
      const body = line.replace(/^[-*]\s*/, "");
      const due = /[（(]\s*截止\s*(\d{1,2}\/\d{1,2})\s*[）)]\s*$/.exec(body);
      inbox.push({
        text: due ? body.slice(0, due.index).trim() : body,
        due: due?.[1],
      });
      return;
    }
    if (section === "due") {
      dueLines.push({ line, at: i });
      return;
    }
    const m = TASK_LINE.exec(line);
    const task =
      m && parseTask(STATUS_MARK[m[1] as string] as TaskStatus, m[2] as string);
    if (typeof section !== "number") bad(i, line, "不在任何一天底下");
    else if (!task) bad(i, line, "讀不懂（要寫「- [ ] 19:00 內容（30 分）」）");
    else week[section]?.push(task);
  });
  const year = Number(weekStart?.slice(0, 4)) || new Date().getFullYear();
  const startMonth = Number(weekStart?.slice(5, 7)) || 1;
  const deadlines: Deadline[] = [];
  for (const d of dueLines) {
    const due = parseDeadline(d.line, year, startMonth);
    if (due) deadlines.push(due);
    else bad(d.at, d.line, "讀不懂（要寫「- 截止 11/24 名稱」）");
  }
  return { weekStart, week, settled, capacity, inbox, deadlines, errors };
}

export interface ScheduleResult {
  schedule?: Schedule;
  errors: CardError[];
}

/** 歷史.md：`- 2026-11-02 起：排 12 塊、做 9 塊`（可再加 `、延後 K 塊`）；讀不懂的行略過。 */
export function parseHistory(text: string): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const line of text.split("\n")) {
    const m =
      /^[-*]\s*\d{4}-(\d{2})-(\d{2})\s*起\s*[：:]\s*排\s*(\d+)\s*塊[、,，]\s*做\s*(\d+)\s*塊(?:[、,，]\s*延後\s*(\d+)\s*塊)?/.exec(
        line.trim(),
      );
    if (m) {
      out.push({
        label: `${m[1]}/${m[2]} 起`,
        planned: Number(m[3]),
        done: Number(m[4]),
        ...(m[5] === undefined ? {} : { postponed: Number(m[5]) }),
      });
    }
  }
  return out;
}

/** 兩個檔都沒有就回 undefined（不蓋鐘樓）；有任何一個就建出 Schedule。 */
export function buildSchedule(
  fixedText: string | undefined,
  weekText: string | undefined,
  historyText?: string,
): ScheduleResult {
  if (fixedText === undefined && weekText === undefined) return { errors: [] };
  const week = weekText === undefined ? undefined : parseWeek(weekText);
  const year = Number(week?.weekStart?.slice(0, 4)) || undefined;
  const fixed =
    fixedText === undefined ? undefined : parseFixed(fixedText, year);
  return {
    schedule: {
      fixed: fixed?.blocks ?? [],
      weekStart: week?.weekStart,
      week: week?.week ?? DAY_NAMES.map(() => []),
      settled: week?.settled ?? [],
      capacity: week?.capacity,
      inbox: week?.inbox ?? [],
      deadlines: [...(fixed?.deadlines ?? []), ...(week?.deadlines ?? [])],
      history: historyText === undefined ? [] : parseHistory(historyText),
    },
    errors: [...(fixed?.errors ?? []), ...(week?.errors ?? [])],
  };
}

/** 今天是週幾（週一 = 0）。 */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * 某天的固定行程片段，依開始時間排序。跨午夜的行程切成兩半：
 * 當天 start–24:00，以及隔天（週日接週一）00:00–end。
 */
export function segmentsOn(blocks: FixedBlock[], day: number): Segment[] {
  const out: Segment[] = [];
  for (const b of blocks) {
    const crosses = b.end <= b.start;
    if (b.days.includes(day)) {
      out.push({
        start: b.start,
        end: crosses ? DAY_MINUTES : b.end,
        name: b.name,
      });
    }
    if (crosses && b.days.includes((day + 6) % 7)) {
      out.push({ start: 0, end: b.end, name: b.name });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 沒寫預計分鐘的小行動，空檔計算時當作 30 分鐘。 */
export const DEFAULT_TASK_MINUTES = 30;

/** 有時間且還占著時間（做了、還沒）的小行動，換成當天的一段。 */
export function taskSpans(tasks: PlanTask[]): Segment[] {
  return tasks
    .filter(
      (t) =>
        t.time !== undefined && (t.status === "done" || t.status === "todo"),
    )
    .map((t) => ({
      start: t.time as number,
      end: Math.min(
        DAY_MINUTES,
        (t.time as number) + (t.minutes ?? DEFAULT_TASK_MINUTES),
      ),
      name: t.text,
    }));
}

/** 沒被占住（固定行程、有時間的小行動）、至少 minLen 分鐘的空檔。 */
export function freeGaps(
  segments: Segment[],
  minLen = 60,
): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    if (s.start - cursor >= minLen) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (DAY_MINUTES - cursor >= minLen)
    gaps.push({ start: cursor, end: DAY_MINUTES });
  return gaps;
}

/** 本週有排的塊數（做了＋還沒）與做了幾塊。 */
export function weekCounts(s: Schedule): { planned: number; done: number } {
  const all = s.week.flat();
  return {
    planned: all.filter((t) => t.status === "done" || t.status === "todo")
      .length,
    done: all.filter((t) => t.status === "done").length,
  };
}

/** 延到本週以外的塊數（`[>]` 且目標不是本週的某一天；延到本週別天的已在那天算一塊）。完成率的分母 ＝ 排＋這個。 */
export function weekPostponed(s: Schedule): number {
  return s.week
    .flat()
    .filter(
      (t) =>
        t.status === "moved" &&
        !/→\s*週[一二三四五六日天]/.test(`${t.text} ${t.note ?? ""}`),
    ).length;
}

/**
 * 今天在本週表的哪一欄（週一 = 0）；表上有起始日但今天不在那一週就回 -1。
 * 沒寫起始日就直接用今天是週幾。
 */
export function weekDayOf(s: Schedule, today: Date): number {
  if (s.weekStart === undefined) return weekdayIndex(today);
  const [y, m, d] = s.weekStart.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const days = Math.round(
    (new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime() -
      new Date(y, m - 1, d).getTime()) /
      86_400_000,
  );
  return days >= 0 && days < 7 ? weekdayIndex(today) : -1;
}

export const STATUS_SYMBOL: Record<TaskStatus, string> = {
  done: "✓",
  todo: "○",
  moved: "→",
  dropped: "✕",
};
export const STATUS_WORD: Record<TaskStatus, string> = {
  done: "做了",
  todo: "還沒",
  moved: "延後",
  dropped: "刪掉",
};
