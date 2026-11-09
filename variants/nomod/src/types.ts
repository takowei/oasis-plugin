import type { Schedule } from "./schedule.ts";

export const STATES = ["building", "waiting", "auto", "dormant"] as const;
export type State = (typeof STATES)[number];

export const BUILDINGS = [
  "academy",
  "studio",
  "shop",
  "tent",
  "well",
  "windmill",
  "gate",
  "camp",
  "core",
] as const;
export type BuildingKind = (typeof BUILDINGS)[number];

export const LANDMARKS = ["academy", "tower"] as const;
export type Landmark = (typeof LANDMARKS)[number];

export const GOAL_KINDS = ["endgame", "goal"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/** 街區的 goal 寫這個值＝接到綠洲核心（水池） */
export const CORE = "core";

export interface Xp {
  current: number;
  target: number;
  label: string;
}

export interface Goal {
  file: string;
  id: string;
  name: string;
  kind: GoalKind;
  /** #rrggbb；沒填時由 buildModel 依序配色 */
  color: string;
  landmark: Landmark;
  body: string;
}

export interface District {
  file: string;
  /** 由檔名衍生，可當 DOM id */
  id: string;
  name: string;
  /** 地圖上的短標籤；沒填就用 name */
  short?: string;
  state: State;
  next: string;
  /** ISO 日期 YYYY-MM-DD */
  since: string;
  due?: string;
  /** 0–1 */
  progress?: number;
  statusText?: string;
  /** goal id 或 "core"；auto 沒填預設 core */
  goal?: string;
  building: BuildingKind;
  /** 1–3 */
  level: number;
  xp?: Xp;
  quest?: string;
  /** 手動擺位 [x, y] */
  tile?: [number, number];
  body: string;
}

export interface CardError {
  file: string;
  reason: string;
}

/** 在建／等你的街區沒有可用的 goal：照樣畫出來，但沒有道路，並在頁面提示 */
export interface Orphan {
  file: string;
  name: string;
  reason: string;
}

/** profile.md 裡使用者拍板的強項；sources 是來源事件 */
export interface Strength {
  name: string;
  sources: string[];
}

/** 學到的事.md 的一條規則（使用者同意才寫入） */
export interface LearnedRule {
  rule: string;
  date: string;
  cause: string;
  use: string;
}

/** 技能/*.md 的索引一筆 */
export interface SkillEntry {
  name: string;
  when: string;
}

/** guard-log.md 的一筆警報（hook 追加；不含指令全文） */
export interface GuardEvent {
  when: string;
  rule: string;
  summary: string;
}

/** 城牆守衛：警報總數與最近幾筆（新的在前） */
export interface GuardLog {
  total: number;
  recent: GuardEvent[];
}

export interface Model {
  goals: Goal[];
  districts: District[];
  errors: CardError[];
  orphans: Orphan[];
  /** 不影響畫面的提醒（例如被忽略的 tile） */
  warnings: CardError[];
  /** 來自 profile.md；沒有就不顯示 */
  strengths?: Strength[];
  /** 來自 guard-log.md；檔案不存在就不畫城牆 */
  guard?: GuardLog;
  /** 來自 學到的事.md；檔案不存在就是 undefined */
  learned?: LearnedRule[];
  /** 來自 技能/*.md；一個都沒有就是 undefined */
  skills?: SkillEntry[];
  /** 來自 時間/固定行程.md、時間/本週.md；兩個檔都沒有就是 undefined（不蓋鐘樓） */
  schedule?: Schedule;
}

/** 手動 tile 的合法範圍（含）；超出就忽略並改自動擺位 */
/** 目標卡數量上限（地圖邊緣放得下的數量）；超過的卡進 errors */
export const MAX_GOALS = 100;
export const TILE_MIN = 1;
export const TILE_MAX = 58;

export interface Card {
  file: string;
  text: string;
}
