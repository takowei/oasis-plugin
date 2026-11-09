import { computeLayout } from "./layout.ts";
import { todayLines } from "./schedule-view.ts";
import { SVG_CHAR_LIMIT, renderSvg } from "./svg.ts";
import type { Model, State } from "./types.ts";
import { buildView, type ViewGroup, type ViewRow } from "./view.ts";

/** `$.ui.resolve(e)` 回傳的元素函式；用最小介面描述，方便測試時替換。 */
type Element = (props: Record<string, unknown>) => unknown;
export interface Elements {
  Box: Element;
  Text: Element;
  Button: Element;
  Svg: Element;
}

const GLYPH: Record<State, string> = {
  building: "▲",
  waiting: "⚑",
  auto: "◎",
  dormant: "·",
};

const TERMINAL_COLOR: Record<State, string> = {
  building: "green",
  waiting: "yellow",
  auto: "cyan",
  dormant: "gray",
};

/** 桌面 app 與 VS Code 畫 SVG 地圖；終端機沒有 Svg，只畫文字清單。 */
export function hasSvg(surface: string): boolean {
  return surface === "desktop" || surface === "vscode";
}

function rowNode(el: Elements, row: ViewRow): unknown {
  const when = row.when.length > 0 ? `  ${row.when.join(" ")}` : "";
  return el.Box({
    flexDirection: "column",
    children: [
      el.Text({ bold: true, children: [`${row.name}${when}`] }),
      el.Text({ dimColor: true, children: [`${row.next}（${row.goal}）`] }),
    ],
  });
}

function groupNode(el: Elements, group: ViewGroup, terminal: boolean): unknown {
  const color = terminal ? { color: TERMINAL_COLOR[group.state] } : {};
  const title = `${GLYPH[group.state]} ${group.title} ${group.count}`;
  return el.Box({
    flexDirection: "column",
    children: [
      el.Text({ bold: true, ...color, children: [title] }),
      ...group.rows.map((row) => rowNode(el, row)),
      el.Text({ children: [" "] }),
    ],
  });
}

/** 圖書館精簡區塊每類最多列幾條（最新的在後面，取最後 N 條）。 */
export const PANE_RECENT = 3;

/** 圖書館區塊的文字行：第一行是條數，其後是學到的事、技能各最新 3 條標題。沒資料回空陣列。 */
export function libraryLines(model: Model): string[] {
  const learned = model.learned ?? [];
  const skills = model.skills ?? [];
  if (learned.length + skills.length === 0) return [];
  const latest = (titles: string[], label: string): string[] =>
    titles.length === 0
      ? []
      : [`  ${label}最新：${titles.slice(-PANE_RECENT).reverse().join("、")}`];
  return [
    `✎ 圖書館：學到 ${learned.length} 條・技能 ${skills.length} 個`,
    ...latest(
      learned.map((r) => r.rule),
      "學到的事",
    ),
    ...latest(
      skills.map((s) => s.name),
      "技能",
    ),
  ];
}

/**
 * Pane 的地圖 SVG：先出動畫版；字數超過 SVG_CHAR_LIMIT 就退回不含 `<animate*>` 的靜態版。
 * animate=false（例如 Pane 非互動、使用者關掉動畫）直接出靜態版。
 */
export function paneSvg(model: Model, animate = true): string {
  const layout = computeLayout(model);
  if (animate) {
    const live = renderSvg(model, layout, { animate: true });
    if (live.length <= SVG_CHAR_LIMIT) return live;
  }
  return renderSvg(model, layout, { animate: false });
}

export function paneTree(
  el: Elements,
  surface: string,
  model: Model,
  today: Date,
  onRefresh: () => void,
): unknown {
  const view = buildView(model, today);
  const terminal = !hasSvg(surface);
  const map = terminal
    ? []
    : [
        el.Svg({
          source: paneSvg(model),
          alt: "綠洲地圖：遠方是終點，道路顏色對應各街區通往的目標",
        }),
      ];
  const dormant =
    view.dormant.length > 0
      ? [
          el.Text({
            dimColor: true,
            children: [`${GLYPH.dormant} 遠方沙丘：${view.dormant.join("、")}`],
          }),
        ]
      : [];
  const orphans = view.orphans.map((o) =>
    el.Text({
      color: "yellow",
      children: [`孤兒 ${o.name}：${o.reason}，沒有道路可通`],
    }),
  );
  const strengths = (model.strengths ?? []).map((s) =>
    el.Text({
      children: [`◆ ${s.name}（${s.sources.length} 件事）`],
    }),
  );
  const guard = model.guard
    ? [
        el.Text({
          color: "yellow",
          children: [`▣ 城牆守衛：共 ${model.guard.total} 次警報`],
        }),
        ...model.guard.recent.map((e) =>
          el.Text({
            dimColor: true,
            children: [`  ${e.when} ${e.rule} ${e.summary}`],
          }),
        ),
      ]
    : [];
  const library = libraryLines(model).map((line, i) =>
    el.Text({ bold: i === 0, dimColor: i > 0, children: [line] }),
  );
  const time = todayLines(model, today).map((line, i) =>
    el.Text({ bold: i === 0, dimColor: i > 0, children: [line] }),
  );
  const errors = view.errors.map((e) =>
    el.Text({ color: "red", children: [`${e.file}：${e.reason}`] }),
  );
  return el.Box({
    flexDirection: "column",
    children: [
      el.Text({ bold: true, children: [`綠洲  ${view.dateLabel}`] }),
      el.Text({ dimColor: true, children: [view.lede] }),
      ...map,
      el.Text({ children: [" "] }),
      ...view.groups.map((g) => groupNode(el, g, terminal)),
      ...dormant,
      ...(strengths.length > 0
        ? [el.Text({ bold: true, children: ["我的強項"] }), ...strengths]
        : []),
      ...guard,
      ...library,
      ...time,
      ...orphans,
      ...errors,
      el.Button({
        key: "refresh",
        label: "重新讀取",
        hotkey: "r",
        onPress: onRefresh,
      }),
    ],
  });
}
