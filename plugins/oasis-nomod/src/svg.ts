import {
  FONT,
  INK,
  LV_PILL,
  LV_W,
  PILL_H,
  QUEST_W,
  TH,
  TW,
  darkenForAA,
  escapeXml,
  iso,
  mix,
  pillWidth,
  proj,
  pts,
  shade,
  tag,
} from "./geom.ts";
import { spriteDefs, usedSymbols } from "./defs.ts";
import {
  type Item,
  type Layout,
  type LabelSpec,
  computeLayout,
  key,
} from "./layout.ts";
import { drawClock } from "./clock-building.ts";
import { drawLibrary } from "./library-building.ts";
import { drawWall } from "./wall.ts";
import { footprint, shadow } from "./solids.ts";
import { drawDistrict, drawLandmark, palm } from "./sprites.ts";
import { EMPTY_HINT, isEmptyCity } from "./profile.ts";
import type { Model } from "./types.ts";

export { escapeXml };

/** mod Pane 的 Svg source 上限（字元數）；pane.ts 超過時改輸出靜態版。 */
export const SVG_CHAR_LIMIT = 131_072;

export interface RenderOptions {
  /** 輸出 SMIL 動畫（煙、天線燈、旗、水波、「！」跳動、車流）；false 時不含任何 `<animate*>`。預設 true。 */
  animate?: boolean;
}

/** 動畫統一無限循環。 */
const LOOP = { repeatCount: "indefinite" };

const GRASS_RADIUS = 3.4;
/** 有城牆時兩側多留的畫面寬度（左右角的塔會超出地面） */
const GUARD_PAD = 70;

/** 空城沒有草地，只剩沙漠與中央水池。 */
function grassRadius(layout: Layout): number {
  return layout.items.length === 0 ? 0 : GRASS_RADIUS;
}

function tileTop(layout: Layout, x: number, y: number): string {
  const c = layout.n / 2 - 0.5;
  const poolX = layout.pool[0];
  const poolY = layout.pool[1];
  const pool = x >= poolX && x <= poolX + 1 && y >= poolY && y <= poolY + 1;
  if (pool) return "#2a7f86";
  const grass = Math.hypot(x - c, y - c) < grassRadius(layout);
  const top = grass ? "#8fbf72" : "#e3cf9c";
  return (x + y) % 2 ? shade(top, 0.95) : top;
}

function groundTile(layout: Layout, x: number, y: number): string {
  const [cx, cy] = iso(x, y);
  const c = layout.n / 2 - 0.5;
  const grass = Math.hypot(x - c, y - c) < grassRadius(layout);
  const side = grass ? "#5f9150" : "#c9ad6d";
  const h = 9;
  let out = "";
  if (x === layout.n - 1 || y === layout.n - 1) {
    out += tag("polygon", {
      points: pts([
        [cx, cy + 2 * TH],
        [cx + TW, cy + TH],
        [cx + TW, cy + TH + h],
        [cx, cy + 2 * TH + h],
      ]),
      fill: shade(side, 0.75),
    });
    out += tag("polygon", {
      points: pts([
        [cx, cy + 2 * TH],
        [cx - TW, cy + TH],
        [cx - TW, cy + TH + h],
        [cx, cy + 2 * TH + h],
      ]),
      fill: side,
    });
  }
  out += tag("use", { href: "#t", x: cx, y: cy, fill: tileTop(layout, x, y) });
  return out;
}

function ground(layout: Layout): string {
  let out = "";
  for (let s = 0; s <= 2 * (layout.n - 1); s++) {
    for (let x = 0; x < layout.n; x++) {
      const y = s - x;
      if (y >= 0 && y < layout.n) out += groundTile(layout, x, y);
    }
  }
  return out;
}

const HILL = "#ebdcb4";
const ROAD_FILL = "#d8ccb0";
const ROAD_EDGE = "#a8977a";
/** 路面往該條路的目標色混多少：淺淺帶色，深淺背景下都還是「路」的顏色。 */
const ROAD_TINT = 0.16;
/** 中線外框：深色描邊，讓虛線的空隙與淺色路面分得開（不只靠顏色）。 */
export const ROAD_OUTLINE = INK;
/** 休眠標籤文字（#efe8da 底上達 AA） */
export const DIM_TEXT = "#726850";
/** 地圖上任務「!」與 HUD 標記的深色字 */
export const MARK_TEXT = "#17262b";

/** 路色 → 虛線樣式；沒有登記的路色畫實線。 */
function dashOf(layout: Layout, color: string): string {
  return layout.dashes?.get(color) ?? "none";
}

/** 一段中線：深色外框在下、目標色虛線在上。 */
function centerLine(d: string, color: string, dash: string, width = 4) {
  return (
    tag("path", {
      d,
      stroke: ROAD_OUTLINE,
      "stroke-width": width + 3,
      class: "road-outline",
    }) +
    tag("path", {
      d,
      stroke: color,
      "stroke-width": width,
      "stroke-dasharray": dash,
      class: "road-line",
    })
  );
}

function cellCorners(x: number, y: number) {
  return [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)] as const;
}

/**
 * 路：整格鋪滿路面色，只在不鄰接其他路格的邊畫邊線；
 * 每條目標路的同色中線從格中心連到相鄰同路格中心，轉角與路口自動接起來。
 */
function roads(layout: Layout): string {
  let fill = "";
  let edges = "";
  for (const k of layout.roads.keys()) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    const [t, r, f, l] = cellCorners(x, y);
    const owner = layout.roads.get(k) ?? ROAD_FILL;
    const surface = /^#[0-9a-f]{6}$/i.test(owner)
      ? mix(ROAD_FILL, owner, ROAD_TINT)
      : ROAD_FILL;
    fill += tag("use", { href: "#t", x: t[0], y: t[1], fill: surface });
    const sides: [[number, number], [number, number], [number, number]][] = [
      [[x, y - 1], t, r],
      [[x + 1, y], r, f],
      [[x, y + 1], f, l],
      [[x - 1, y], l, t],
    ];
    for (const [[nx, ny], a, b] of sides) {
      if (layout.roads.has(key([nx, ny]))) continue;
      edges += tag("path", { d: `M${a[0]} ${a[1]} L${b[0]} ${b[1]}` });
    }
  }
  /** 同色中線併成一條 path，省字數。 */
  const byColor = new Map<string, string>();
  for (const { a, b, color } of layout.links) {
    const [ax, ay] = proj(a[0] + 0.5, a[1] + 0.5);
    const [bx, by] = proj(b[0] + 0.5, b[1] + 0.5);
    byColor.set(color, `${byColor.get(color) ?? ""}M${ax} ${ay}L${bx} ${by}`);
  }
  const center = [...byColor]
    .map(([color, d]) => centerLine(d, color, dashOf(layout, color)))
    .join("");
  return tag(
    "g",
    { class: "roads", "aria-hidden": "true" },
    fill +
      tag(
        "g",
        { stroke: ROAD_EDGE, "stroke-width": 1.6, fill: "none" },
        edges,
      ) +
      tag(
        "g",
        {
          "stroke-linecap": "round",
          fill: "none",
        },
        center,
      ),
  );
}

/** 遠方沙丘整寬（含城牆加寬的兩側），不在任何一側切邊。 */
function horizon(layout: Layout, pad: number): string {
  const half = layout.view.x1 + pad;
  const k = half / 460;
  const fade = tag(
    "defs",
    {},
    tag(
      "linearGradient",
      { id: "hill-fade", x1: 0, y1: 0, x2: 0, y2: 1 },
      tag("stop", { offset: 0.55, "stop-color": HILL }) +
        tag("stop", { offset: 1, "stop-color": HILL, "stop-opacity": 0 }),
    ),
  );
  const hills = tag("path", {
    d: `M${-half} -30 C${-320 * k} -64 ${-210 * k} -56 ${-90 * k} -46 C${30 * k} -36 ${150 * k} -76 ${280 * k} -62 C${360 * k} -54 ${420 * k} -48 ${half} -52 L${half} 40 L${-half} 40Z`,
    fill: "url(#hill-fade)",
  });
  const end = layout.endgame;
  if (!end) return fade + hills;
  const palace = tag("path", {
    d: "M-30 -52 V-70 h8 v-8 h8 v8 h6 v-14 l8 -8 l8 8 v14 h6 v-8 h8 v8 h8 V-52Z",
    fill: "#cdbf9d",
  });
  const words = `終點：${end.name}`;
  const w = pillWidth(words);
  /** 淺色底卡：深色背景下文字也看得清楚。 */
  const card = tag("rect", {
    x: -w / 2,
    y: -52,
    width: w,
    height: 20,
    rx: 10,
    fill: "#fbf7ec",
    stroke: "#8a7a5a",
    "stroke-width": 1.2,
  });
  const text = tag(
    "text",
    {
      x: 0,
      y: -38,
      "text-anchor": "middle",
      "font-size": 13,
      fill: "#5d4f33",
    },
    escapeXml(words),
  );
  return fade + hills + palace + card + text;
}

function water(layout: Layout, animate: boolean): string {
  const [px, py] = iso(layout.pool[0] + 1, layout.pool[1] + 1);
  const waves = animate
    ? tag("animate", {
        attributeName: "rx",
        values: "44;58;44",
        dur: "4s",
        ...LOOP,
      }) +
      tag("animate", {
        attributeName: "opacity",
        values: ".25;.5;.25",
        dur: "4s",
        ...LOOP,
      })
    : "";
  return tag(
    "ellipse",
    { cx: px, cy: py, rx: 52, ry: 20, fill: "#6fc0bd", opacity: 0.35 },
    waves,
  );
}

/** 「！」上下跳：用 translate 動畫，begin 依序錯開，避免整排同步。 */
function bounce(order: number): string {
  return tag("animateTransform", {
    attributeName: "transform",
    type: "translate",
    values: "0 0;0 -5;0 0",
    keyTimes: "0;.5;1",
    calcMode: "spline",
    keySplines: ".3 0 .6 1;.4 0 .7 1",
    dur: "1.1s",
    begin: `${Math.round(((order * 0.37) % 1.1) * 100) / 100}s`,
    ...LOOP,
  });
}

/** 每種路色最多一台車，整張圖最多 MAX_CARS 台。 */
const MAX_CARS = 6;

/** 路線上連續鋪了路的最長一段（格）。 */
function pavedRun(layout: Layout, tiles: [number, number][]) {
  let best: [number, number][] = [];
  let run: [number, number][] = [];
  for (const t of tiles) {
    if (layout.roads.has(key(t))) run.push(t);
    else run = [];
    if (run.length > best.length) best = [...run];
  }
  return best;
}

/** 車流：沿每種路色最長的一段路來回跑（animateMotion）；不動畫時不畫車。 */
function cars(layout: Layout, animate: boolean): string {
  if (!animate) return "";
  const longest = new Map<string, [number, number][]>();
  for (const r of layout.routes) {
    const run = pavedRun(layout, r.tiles);
    if (run.length >= 2 && run.length > (longest.get(r.color)?.length ?? 0))
      longest.set(r.color, run);
  }
  return [...longest]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CARS)
    .map(([color, run], i) => {
      const there = run.map(([x, y]) => proj(x + 0.5, y + 0.5));
      const loop = [...there, ...there.slice(0, -1).reverse()];
      const d = `M${loop.map(([x, y]) => `${x} ${y + 2}`).join("L")}`;
      const motion = tag("animateMotion", {
        path: d,
        dur: `${Math.max(4, run.length * 1.6)}s`,
        begin: `-${i * 1.3}s`,
        ...LOOP,
      });
      return tag("use", { href: "#car", color }, motion);
    })
    .join("");
}

/** 標籤膠囊：任務「！」與 Lv 都收在膠囊裡，休眠用實心淡色。 */
function label(l: LabelSpec, id: string, order = 0, animate = false): string {
  /** 目標膠囊底色壓暗到白字達 WCAG AA */
  const fill = l.goalColor
    ? darkenForAA(l.goalColor)
    : l.dim
      ? "#efe8da"
      : "#fffaf0";
  const textFill = l.goalColor ? "#fff" : l.dim ? DIM_TEXT : INK;
  const x0 = l.cx - l.w / 2;
  const pill = tag("rect", {
    x: x0,
    y: l.cy - PILL_H / 2,
    width: l.w,
    height: PILL_H,
    rx: PILL_H / 2,
    fill,
    stroke: l.dim ? "#b9b0a0" : INK,
    "stroke-width": 1.5,
  });
  /** 動畫掛在 circle 與 text 自己身上（同一個 begin），不另包 `<g>`。 */
  const jump = animate ? bounce(order) : "";
  const quest = l.quest
    ? tag(
        "circle",
        {
          cx: x0 + 18,
          cy: l.cy,
          r: 9,
          fill: "#e9a23b",
          stroke: INK,
          "stroke-width": 1,
        },
        jump,
      ) +
      tag(
        "text",
        {
          x: x0 + 18,
          y: l.cy + 4.5,
          "text-anchor": "middle",
          "font-size": FONT.quest,
          "font-weight": 700,
          fill: MARK_TEXT,
        },
        `${jump}!`,
      )
    : "";
  const left = x0 + 9 + (l.quest ? QUEST_W : 0);
  const textW = l.w - 18 - (l.quest ? QUEST_W : 0) - (l.lv ? LV_W : 0);
  const text = tag(
    "text",
    {
      x: left + textW / 2,
      y: l.cy + 5,
      "text-anchor": "middle",
      "font-size": FONT.name,
      "font-weight": 700,
      fill: textFill,
    },
    escapeXml(l.text),
  );
  const lv =
    l.lv === undefined
      ? ""
      : tag("rect", {
          x: x0 + l.w - 9 - LV_PILL.w,
          y: l.cy - LV_PILL.h / 2,
          width: LV_PILL.w,
          height: LV_PILL.h,
          rx: 5,
          fill: INK,
        }) +
        tag(
          "text",
          {
            x: x0 + l.w - 9 - LV_PILL.w / 2,
            y: l.cy + 4.5,
            "text-anchor": "middle",
            "font-size": FONT.lv,
            "font-weight": 700,
            fill: "#fff",
          },
          `Lv.${l.lv}`,
        );
  return tag("g", { class: "lbl", "data-id": id }, pill + quest + text + lv);
}

function sprite(item: Item, animate: boolean): string {
  if (item.goal) {
    return drawLandmark(
      item.id,
      item.goal.landmark,
      item.goal.color,
      item.tile,
      item.goal.name,
    );
  }
  if (item.library !== undefined) return drawLibrary(item);
  if (item.clock) return drawClock(item);
  return drawDistrict(
    item.district as NonNullable<Item["district"]>,
    item.tile,
    animate,
  );
}

function legend(layout: Layout): string {
  return layout.legend
    .map((e) => {
      const y = e.y + 11;
      /** 淺色底卡：圖例畫在地面外，深色背景下也看得清楚。 */
      const card = tag("rect", {
        x: e.x - 5,
        y: e.y,
        width: e.w + 10,
        height: 22,
        rx: 11,
        fill: "#fbf7ec",
        stroke: INK,
        "stroke-width": 1.2,
      });
      /** 圖例色塊與道路中線同一畫法：深色外框＋同一種虛線。 */
      const swatch = tag(
        "g",
        { "stroke-linecap": "round", fill: "none", "aria-hidden": "true" },
        centerLine(`M${e.x + 2} ${y} h20`, e.color, e.dash ?? "none"),
      );
      const text = tag(
        "text",
        { x: e.x + 30, y: y + 4.5, "font-size": FONT.legend, fill: "#4a5a5e" },
        escapeXml(e.text),
      );
      return tag("g", { class: "legend" }, card + swatch + text);
    })
    .join("");
}

function emptyHint(layout: Layout): string {
  const [x, y] = iso(layout.pool[0] + 1, layout.pool[1] + 1);
  const pill = tag("rect", {
    x: x - 170,
    y: y + 58,
    width: 340,
    height: 30,
    rx: 15,
    fill: "#fbf7ec",
    stroke: INK,
    "stroke-width": 1.5,
  });
  const text = tag(
    "text",
    {
      x,
      y: y + 78,
      "text-anchor": "middle",
      "font-size": 14,
      "font-weight": 700,
      fill: INK,
    },
    escapeXml(EMPTY_HINT),
  );
  return tag("g", { class: "empty-hint" }, pill + text);
}

export const SVG_TITLE = "綠洲城市地圖";
export const SVG_TITLE_ID = "oasis-map-title";
export const SVG_DESC_ID = "oasis-map-desc";

/** `<desc>` 的文字：有幾棟建築、終點、每條路的顏色與線型。 */
function describe(model: Model, layout: Layout): string {
  const end = layout.endgame ? `遠方是終點「${layout.endgame.name}」。` : "";
  const lines = layout.legend
    .map((e) => `${e.text}（${dashWord(e.dash)}）`)
    .join("、");
  const roads = lines === "" ? "" : `道路：${lines}。`;
  return `${end}城裡有 ${layout.items.length} 棟可以點選的建築，用 Tab 鍵切換、Enter 或空白鍵開啟說明。${roads}`;
}

function dashWord(dash: string | undefined): string {
  return dash === undefined || dash === "none" ? "實線" : `虛線 ${dash}`;
}

/**
 * 純函式：Model → SVG 字串（等角城市地圖）。不依賴 DOM。
 * 建築、地標、地磚、棕櫚、車都是 `<use>`；`<defs>` 只放這張圖用到的 symbol。
 */
export function renderSvg(
  model: Model,
  layout = computeLayout(model),
  options: RenderOptions = {},
): string {
  const animate = options.animate ?? true;
  const pad = model.guard ? GUARD_PAD : 0;
  const { x0, y0, x1, y1 } = layout.view;
  const depth = (i: Item) => i.tile[0] + i.tile[1] + 2 * i.size;
  const sorted = [...layout.items].sort((a, b) => depth(a) - depth(b));
  const shadows = sorted
    .map((i) => shadow(footprint(i.tile, i.size), i.top))
    .join("");
  let quests = 0;
  const labels = sorted
    .map((i) => label(i.label, i.id, i.label.quest ? quests++ : 0, animate))
    .join("");
  const city =
    tag("g", { class: "ground", "aria-hidden": "true" }, ground(layout)) +
    roads(layout) +
    tag(
      "g",
      { class: "water", "aria-hidden": "true" },
      water(layout, animate),
    ) +
    (model.guard ? drawWall(layout.n, model.guard.total) : "") +
    tag(
      "g",
      { class: "palms", "aria-hidden": "true" },
      layout.palms.map(palm).join(""),
    ) +
    tag("g", { class: "shadows", "aria-hidden": "true" }, shadows) +
    tag("g", { class: "cars", "aria-hidden": "true" }, cars(layout, animate)) +
    sorted.map((i) => sprite(i, animate)).join("") +
    /** 標籤是建築名稱的視覺重複（名稱已在建築的 title／aria-label），對輔助技術隱藏。 */
    tag("g", { class: "labels", "aria-hidden": "true" }, labels) +
    legend(layout) +
    (isEmptyCity(model) ? emptyHint(layout) : "");
  /** defs 放在遠景之後：遠景（終點剪影）之前不出現任何多邊形。 */
  const head =
    tag("title", { id: SVG_TITLE_ID }, escapeXml(SVG_TITLE)) +
    tag("desc", { id: SVG_DESC_ID }, escapeXml(describe(model, layout)));
  const body =
    head +
    tag(
      "g",
      { class: "horizon", "aria-hidden": "true" },
      horizon(layout, pad),
    ) +
    spriteDefs(usedSymbols(city), animate) +
    city;
  const vbW = x1 - x0 + 2 * pad;
  return tag(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `${x0 - pad} ${y0} ${vbW} ${y1 - y0}`,
      role: "group",
      "aria-labelledby": SVG_TITLE_ID,
      "aria-describedby": SVG_DESC_ID,
      style: `--vb-w:${Math.round(vbW)}`,
      "font-family": "'Noto Sans CJK TC', sans-serif",
    },
    body,
  );
}
