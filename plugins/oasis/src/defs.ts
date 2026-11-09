import { INK, type Pt, TH, TW, proj, pts, shade, tag } from "./geom.ts";
import {
  FADED,
  type Foot,
  type Paint,
  SOLID,
  box,
  footprint,
  poly,
  pyramid,
  seg,
  windows,
} from "./solids.ts";
import {
  FLAG,
  HOUSE,
  HOUSE_DECOR,
  HOUSE_KEY,
  HOUSE_PEAK,
  LANDMARK_ID,
  LANDMARK_SIZE,
  LANDMARK_SPEC,
  palmShape,
  wallHeight,
} from "./sprites.ts";
import { LANDMARKS, type Landmark } from "./types.ts";

/**
 * `<defs>`：漸層＋精靈 symbol。只產生這張地圖真的 `<use>` 到的 symbol，
 * 每個 symbol 的原點都是磁磚上緣頂點（iso(x, y)），建築往上（負 y）畫，所以要 overflow="visible"。
 * symbol 裡不再巢狀 `<use>`（窗戶直接展開），避開不支援巢狀 use 的渲染器。
 */

/** 地面磁磚、路格共用的菱形；填色由 `<use fill>` 給。 */
const TILE = tag("polygon", {
  points: pts([
    [0, 0],
    [TW, TH],
    [0, 2 * TH],
    [-TW, TH],
  ]),
  stroke: "rgba(23,38,43,.1)",
  "stroke-width": 1,
});

function linear(id: string, from: string, to: string, diagonal = false) {
  const dir: Record<string, number> = diagonal
    ? { x1: 0, y1: 0, x2: 1, y2: 1 }
    : { x2: 0, y2: 1 };
  return tag(
    "linearGradient",
    { id, ...dir },
    tag("stop", { offset: 0, "stop-color": from }) +
      tag("stop", { offset: 1, "stop-color": to }),
  );
}

/** 光從左上來：左牆亮、右牆暗、由上往下變暗；屋頂左坡亮、右坡暗。 */
function houseGradients(k: string, wall: string, roof: string): string {
  return (
    linear(`${k}L`, shade(wall, 0.97), shade(wall, 0.82)) +
    linear(`${k}R`, shade(wall, 0.76), shade(wall, 0.6)) +
    linear(`${k}T`, shade(roof, 1.1), shade(roof, 0.86), true) +
    linear(`${k}D`, shade(roof, 0.78), shade(roof, 0.57))
  );
}

const GRADIENTS: Record<string, () => string> = Object.fromEntries(
  Object.entries(HOUSE_KEY).map(([kind, k]) => {
    const { wall, roof } = HOUSE[kind] as { wall: string; roof: string };
    return [k, () => houseGradients(k, wall, roof)];
  }),
);

const LOOP = { repeatCount: "indefinite" };

const SMOKE = { fill: "#a3abad", stroke: "#5d6a6e", "stroke-width": 0.6 };

/** 一團煙：從 (x, y) 往上往右飄、變大、淡出；不動畫時只留一小團。 */
function puff([x, y]: Pt, begin: number, animate: boolean): string {
  if (!animate) return tag("circle", { cx: x, cy: y, r: 3, ...SMOKE });
  const anim = (attributeName: string, values: string) =>
    tag("animate", {
      attributeName,
      values,
      dur: "3s",
      begin: `${begin}s`,
      ...LOOP,
    });
  return tag(
    "circle",
    { cx: x, cy: y, r: 3, ...SMOKE, opacity: 0 },
    anim("cy", `${y};${y - 22}`) +
      anim("cx", `${x};${x + 4};${x + 9}`) +
      anim("r", "3;7") +
      anim("opacity", ".9;0"),
  );
}

/** Lv3 的尖頂裝飾：書院插旗、工作室天線（紅燈閃）、商行煙囪冒煙。高度都在 HOUSE_DECOR 內。 */
function decor(
  kind: string,
  f: Foot,
  h: number,
  p: Paint,
  animate: boolean,
): string {
  const apex = proj(f.x + f.w / 2, f.y + f.d / 2, h + HOUSE_PEAK);
  const tip: Pt = [apex[0], apex[1] - HOUSE_DECOR];
  const pole = { stroke: INK, "stroke-width": 1.4 };
  if (kind === "academy") {
    return (
      seg(apex, tip, pole) +
      poly(
        [tip, [tip[0] + 10, tip[1] + 3], [tip[0], tip[1] + 6]],
        p("#e9a23b"),
        { "stroke-width": 1.2 },
      )
    );
  }
  if (kind === "studio") {
    const bar = tip[1] + 4;
    const light = tag(
      "circle",
      { cx: tip[0], cy: tip[1], r: 2.4, fill: p("#e9503b"), stroke: INK },
      animate
        ? tag("animate", {
            attributeName: "opacity",
            values: "1;.25;1",
            dur: "1.6s",
            ...LOOP,
          })
        : "",
    );
    return (
      seg(apex, tip, pole) +
      seg([tip[0] - 5, bar], [tip[0] + 5, bar], pole) +
      light
    );
  }
  const chimney = { x: f.x + f.w * 0.55, y: f.y + f.d * 0.2, w: 0.16, d: 0.16 };
  const top = h + HOUSE_PEAK - 6;
  const mouth = proj(chimney.x + 0.08, chimney.y + 0.08, top + 3);
  const smoke = [0, 1, 2].map((i) => puff(mouth, i, animate)).join("");
  return (
    box(chimney, h + 8, top - h - 8, "#8a5a3c", p) +
    (animate ? smoke : puff(mouth, 0, false))
  );
}

/** 房子精靈：牆＋窗＋門＋四角錐屋頂；實心版用漸層，休眠版用褪色實心色。 */
function houseSymbol(
  kind: string,
  level: number,
  faded: boolean,
  animate: boolean,
) {
  const k = HOUSE_KEY[kind] as string;
  const { wall, roof } = HOUSE[kind] as { wall: string; roof: string };
  const f = footprint([0, 0]);
  const h = wallHeight(kind, level);
  const p = faded ? FADED : SOLID;
  const rows = kind === "academy" && level >= 2 ? 2 : 1;
  const wallFills = faded ? {} : { left: `url(#${k}L)`, right: `url(#${k}R)` };
  const roofFills = faded ? {} : { left: `url(#${k}T)`, right: `url(#${k}D)` };
  const door = poly(
    [
      proj(f.x + f.w * 0.3, f.y + f.d, 0),
      proj(f.x + f.w * 0.5, f.y + f.d, 0),
      proj(f.x + f.w * 0.5, f.y + f.d, 14),
      proj(f.x + f.w * 0.3, f.y + f.d, 14),
    ],
    p(shade(roof, 0.7)),
    { "stroke-width": 1.1 },
  );
  return (
    box(f, 0, h, wall, p, wallFills) +
    windows(f, h, rows) +
    door +
    pyramid(f, h, HOUSE_PEAK, roof, p, roofFills) +
    (level >= 3 ? decor(kind, f, h, p, animate && !faded) : "")
  );
}

/** 目標地標：屋頂、旗子用 currentColor；右坡疊一層黑色半透明當陰面。 */
function landmarkSymbol(landmark: Landmark, animate: boolean): string {
  const s = LANDMARK_SPEC[landmark];
  const f = footprint([0, 0], LANDMARK_SIZE);
  const { x, y, w, d } = f;
  const apex = proj(x + w / 2, y + d / 2, s.wall + s.peak);
  const F = proj(x + w, y + d, s.wall);
  const R = proj(x + w, y, s.wall);
  const [ax, ay] = [apex[0], apex[1] - FLAG];
  const flag = (dy: number) =>
    pts([
      [ax, ay],
      [ax + 14, ay + 4 + dy],
      [ax, ay + 8],
    ]);
  const pennant = tag(
    "polygon",
    {
      points: flag(0),
      fill: "currentColor",
      stroke: INK,
      "stroke-width": 1.2,
      "stroke-linejoin": "round",
    },
    animate
      ? tag("animate", {
          attributeName: "points",
          values: [flag(0), flag(3), flag(-1), flag(0)].join(";"),
          dur: "1.8s",
          ...LOOP,
        })
      : "",
  );
  return (
    box(f, 0, s.wall, HOUSE.academy?.wall ?? "#e4ddd0", SOLID, {
      left: "url(#aL)",
      right: "url(#aR)",
    }) +
    windows(f, s.wall, s.rows) +
    pyramid(f, s.wall, s.peak, "#000000", SOLID, {
      left: "currentColor",
      right: "currentColor",
    }) +
    tag("polygon", { points: pts([F, R, apex]), fill: "#000", opacity: 0.28 }) +
    seg(apex, [ax, ay], { stroke: INK, "stroke-width": 1.6 }) +
    pennant
  );
}

/** 小車：車身用 currentColor（路的顏色），車頂淺色。 */
const CAR =
  poly(
    [
      [-9, -4],
      [0, 0.5],
      [0, 6.5],
      [-9, 2],
    ],
    "currentColor",
    { "stroke-width": 1.2 },
  ) +
  poly(
    [
      [0, 0.5],
      [9, -4],
      [9, 2],
      [0, 6.5],
    ],
    "currentColor",
    { "stroke-width": 1.2 },
  ) +
  tag("polygon", {
    points: "0,0.5 9,-4 9,2 0,6.5",
    fill: "#000",
    opacity: 0.25,
  }) +
  poly(
    [
      [-9, -4],
      [0, -8.5],
      [9, -4],
      [0, 0.5],
    ],
    "#fffaf0",
    { "stroke-width": 1.2 },
  );

interface SymbolSpec {
  /** 需要哪幾組漸層（GRADIENTS 的 key） */
  gradients: string[];
  body: (animate: boolean) => string;
}

function catalog(): Map<string, SymbolSpec> {
  const out = new Map<string, SymbolSpec>();
  out.set("t", { gradients: [], body: () => TILE });
  out.set("palm", { gradients: [], body: palmShape });
  out.set("car", { gradients: [], body: () => CAR });
  for (const [kind, k] of Object.entries(HOUSE_KEY)) {
    for (const level of [1, 2, 3]) {
      out.set(`${k}${level}`, {
        gradients: [k],
        body: (a) => houseSymbol(kind, level, false, a),
      });
      out.set(`${k}${level}f`, {
        gradients: [],
        body: (a) => houseSymbol(kind, level, true, a),
      });
    }
  }
  for (const lm of LANDMARKS) {
    out.set(LANDMARK_ID[lm], {
      gradients: ["a"],
      body: (a) => landmarkSymbol(lm, a),
    });
  }
  return out;
}

const SYMBOLS = catalog();

/** 所有 symbol id（測試用：確認每個 use 都對得到）。 */
export const SYMBOL_IDS: readonly string[] = [...SYMBOLS.keys()];

/** 從已產生的 SVG 本體找出用到的 `href="#id"`。 */
export function usedSymbols(svgBody: string): string[] {
  const ids = new Set<string>();
  for (const m of svgBody.matchAll(/href="#([A-Za-z0-9_-]+)"/g)) {
    if (SYMBOLS.has(m[1] as string)) ids.add(m[1] as string);
  }
  return [...ids];
}

/** 產生 `<defs>`：用到的 symbol 與它們需要的漸層；animate=false 時不含任何 `<animate*>`。 */
export function spriteDefs(used: Iterable<string>, animate: boolean): string {
  const specs = [...new Set(used)]
    .filter((id) => SYMBOLS.has(id))
    .sort()
    .map((id) => [id, SYMBOLS.get(id) as SymbolSpec] as const);
  if (specs.length === 0) return "";
  const grads = [...new Set(specs.flatMap(([, s]) => s.gradients))].sort();
  const symbols = specs
    .map(([id, s]) =>
      tag("symbol", { id, overflow: "visible" }, s.body(animate)),
    )
    .join("");
  return tag(
    "defs",
    {},
    grads.map((g) => GRADIENTS[g]?.() ?? "").join("") + symbols,
  );
}
