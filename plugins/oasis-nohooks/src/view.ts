import { daysSince } from "./model.ts";
import { EMPTY_HINT } from "./profile.ts";
import { CORE, type District, type Model, type State } from "./types.ts";

export type Tone = "who" | "ok" | "plain";

export interface ViewRow {
  name: string;
  next: string;
  /** 右側文字，多行以陣列表示 */
  when: string[];
  tone: Tone;
  progress?: number;
  /** 「通往 X」「接綠洲核心」或「還沒接到目標」 */
  goal: string;
}

export interface ViewGroup {
  state: State;
  title: string;
  count: number;
  rows: ViewRow[];
}

export interface View {
  dateLabel: string;
  lede: string;
  groups: ViewGroup[];
  dormant: string[];
  errors: Model["errors"];
  orphans: Model["orphans"];
  hud: { goals: number; tasks: number; building: number; auto: number };
}

export function goalText(d: District, model: Model): string {
  if (d.goal === CORE) return "接綠洲核心";
  const goal = model.goals.find((g) => g.id === d.goal);
  return goal ? `通往 ${goal.name}` : "還沒接到目標";
}

export const STATE_TITLE: Record<State, string> = {
  building: "在建",
  waiting: "等你動手",
  auto: "自動運轉",
  dormant: "休眠",
};

const LISTED: State[] = ["building", "waiting", "auto"];
const WEEKDAYS = "日一二三四五六";

export function dateLabel(today: Date): string {
  const weekday = WEEKDAYS[today.getDay()];
  return `${today.getMonth() + 1} 月 ${today.getDate()} 日 週${weekday}`;
}

function whenOf(d: District, today: Date): { when: string[]; tone: Tone } {
  if (d.state === "waiting") {
    const days = daysSince(d.since, today);
    const text = d.due ?? (days === 0 ? "今天新增" : `等 ${days} 天`);
    return { when: text.split("\n"), tone: "who" };
  }
  const text = d.statusText ?? d.due ?? "";
  return {
    when: text === "" ? [] : text.split("\n"),
    tone: d.statusText ? "ok" : "plain",
  };
}

function rowOf(d: District, model: Model, today: Date): ViewRow {
  return {
    goal: goalText(d, model),
    name: d.name,
    next: d.next,
    ...whenOf(d, today),
    progress: d.progress,
  };
}

function ledeOf(model: Model): string {
  if (model.districts.length === 0)
    return model.goals.length === 0
      ? EMPTY_HINT
      : "還沒有街區，先在 districts/ 放一張卡片。";
  const n = (s: State) => model.districts.filter((d) => d.state === s).length;
  return `今天 ${n("building")} 條線在建、${n("waiting")} 件等你動手、${n("auto")} 條自動運轉。`;
}

export function buildView(model: Model, today: Date): View {
  const groups = LISTED.map((state) => {
    const rows = model.districts
      .filter((d) => d.state === state)
      .map((d) => rowOf(d, model, today));
    return { state, title: STATE_TITLE[state], count: rows.length, rows };
  }).filter((g) => g.count > 0);
  return {
    dateLabel: dateLabel(today),
    lede: ledeOf(model),
    groups,
    dormant: model.districts
      .filter((d) => d.state === "dormant")
      .map((d) => d.name),
    errors: model.errors,
    orphans: model.orphans,
    hud: {
      goals: model.goals.filter((g) => g.kind === "goal").length,
      tasks: model.districts.filter((d) => d.state === "waiting").length,
      building: model.districts.filter((d) => d.state === "building").length,
      auto: model.districts.filter((d) => d.state === "auto").length,
    },
  };
}
