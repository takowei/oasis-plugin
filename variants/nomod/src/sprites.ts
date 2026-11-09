import { INK, type Pt, escapeXml, iso, proj, tag } from "./geom.ts";
import {
  FADED,
  type Foot,
  type Paint,
  SOLID,
  type Tile,
  box,
  footprint,
  poly,
  seg,
  windows,
} from "./solids.ts";
import type { District, Landmark } from "./types.ts";

/** 建築畫法與它的高度；高度給 layout 算擺位範圍與影子，畫法與高度共用同一組數字。 */

/** 磁磚中心的畫面座標。 */
export const centerOf = ([tx, ty]: Tile): Pt => proj(tx + 0.5, ty + 0.5);

/** 棕櫚樹本體，原點在樹根；`<symbol id="palm">` 用。 */
export function palmShape(): string {
  const trunk = tag("path", { d: "M0 0q5 -18 1 -36" });
  const leaves = tag("path", {
    d: "M1 -36q-15 -4 -22 6M1 -36q13 -6 22 3M1 -36q-4 -11 -14 -12M1 -36q8 -11 17 -7",
  });
  return tag(
    "g",
    {
      stroke: "#2f6b4f",
      "stroke-width": 2.6,
      fill: "none",
      "stroke-linecap": "round",
    },
    trunk + leaves,
  );
}

export function palm(tile: Tile): string {
  const [x, y] = centerOf(tile);
  return tag("use", { href: "#palm", x, y });
}

const BOX_HEIGHT: Record<string, [number, number]> = {
  academy: [30, 10],
  studio: [24, 10],
  shop: [28, 10],
  core: [20, 8],
};

/** 房子的尖頂高度（比例對照 mock：房 34）。 */
export const HOUSE_PEAK = 34;
/** Lv3 房子尖頂上的裝飾（旗、天線、煙）多出的高度；影子與標籤一起算進去。 */
export const HOUSE_DECOR = 14;
const SCAFFOLD_RISE = 22;

/** 牆高（不含尖頂）。 */
export function wallHeight(building: string, level: number): number {
  const [base, step] = BOX_HEIGHT[building] ?? [24, 10];
  return base + step * (level - 1);
}

function boxHeight(d: District): number {
  return wallHeight(d.building, d.level);
}

/** 有 `<symbol>` 精靈的房子種類 → symbol id 字首。 */
export const HOUSE_KEY: Record<string, string> = {
  academy: "a",
  studio: "s",
  shop: "p",
};

/** 房子精靈的 symbol id：種類字首＋等級，休眠加 f（例：a2、p3f）。 */
export function houseId(building: string, level: number, faded: boolean) {
  const lv = Math.max(1, Math.min(3, Math.round(level)));
  return `${HOUSE_KEY[building] ?? "a"}${lv}${faded ? "f" : ""}`;
}

function scaffolded(d: District): boolean {
  return d.building === "core" && d.state === "building";
}

/** 結構最高點離地面多少 px（含尖頂、鷹架、風車葉）；影子長度與標籤高度都以此為準。 */
export function heightOf(d: District): number {
  switch (d.building) {
    case "academy":
    case "studio":
    case "shop":
      return boxHeight(d) + HOUSE_PEAK + (d.level >= 3 ? HOUSE_DECOR : 0);
    case "core":
      return boxHeight(d) + (scaffolded(d) ? SCAFFOLD_RISE : 0);
    case "tent":
    case "camp":
      return 28;
    case "well":
      return 14;
    case "windmill":
      return 66;
    case "gate":
      return 44;
  }
}

/** 其中尖的那一段（屋頂）高度：擺位碰撞時這段比底下的牆窄。 */
export function roofOf(d: District): number {
  switch (d.building) {
    case "academy":
    case "studio":
    case "shop":
      return HOUSE_PEAK;
    case "tent":
    case "camp":
      return 28;
    default:
      return 0;
  }
}

export const HOUSE: Record<string, { wall: string; roof: string }> = {
  academy: { wall: "#e4ddd0", roof: "#2e6b4f" },
  studio: { wall: "#e2cbd3", roof: "#b05c78" },
  shop: { wall: "#f3ede2", roof: "#d9862b" },
};

const SCAFFOLD = { stroke: "#c98a2b", "stroke-width": 2.4 };

/** 施工中：實心方塊外面加鷹架線。 */
function scaffold(f: Foot, h: number): string {
  const { x, y, w, d } = f;
  const corners: Tile[] = [
    [x, y + d],
    [x + w, y + d],
    [x + w, y],
  ];
  const poles = corners.map(([px, py]) =>
    seg(proj(px, py), proj(px, py, h + SCAFFOLD_RISE), SCAFFOLD),
  );
  const rail = (a: Tile, b: Tile) =>
    seg(proj(a[0], a[1], h + 16), proj(b[0], b[1], h + 16), SCAFFOLD);
  return (
    poles.join("") +
    rail([x, y + d], [x + w, y + d]) +
    rail([x + w, y + d], [x + w, y])
  );
}

function core(d: District, f: Foot, p: Paint): string {
  const h = boxHeight(d);
  return (
    box(f, 0, h, "#8fbf9a", p) +
    (scaffolded(d) ? scaffold(f, h) : windows(f, h, 1))
  );
}

function tent(f: Foot, p: Paint, camp: boolean): string {
  const { x, y, w, d } = f;
  const apex = proj(x + w / 2, y + d / 2, 28);
  const body =
    poly([proj(x, y + d), proj(x + w, y + d), apex], p("#e5ded0")) +
    poly([proj(x + w, y + d), proj(x + w, y), apex], p("#bfb9ab")) +
    poly(
      [
        proj(x + w * 0.4, y + d),
        proj(x + w * 0.6, y + d),
        proj(x + w / 2, y + d, 14),
      ],
      p("#5c4a3a"),
    );
  const fire = camp
    ? (([cx, cy]: Pt) =>
        tag("circle", { cx, cy, r: 4, fill: p("#e3a12f"), stroke: INK }))(
        proj(x + w + 0.08, y + d * 0.85),
      )
    : "";
  return body + fire;
}

function windmill(f: Foot, p: Paint, animate: boolean): string {
  const { x, y, w, d } = f;
  const inner = { x: x + 0.2, y: y + 0.2, w: w - 0.4, d: d - 0.4 };
  const hub = proj(x + w - 0.2, y + d / 2, 38);
  const blades = [0, 90, 180, 270]
    .map((deg) => {
      const r = (deg * Math.PI) / 180;
      return seg(hub, [hub[0] + 24 * Math.cos(r), hub[1] + 24 * Math.sin(r)], {
        stroke: p("#2a7a7d"),
        "stroke-width": 5,
        "stroke-linecap": "round",
      });
    })
    .join("");
  return (
    box(inner, 0, 46, "#f3ede2", p) +
    tag(
      "g",
      {},
      blades +
        (animate
          ? tag("animateTransform", {
              attributeName: "transform",
              type: "rotate",
              from: `0 ${hub[0]} ${hub[1]}`,
              to: `360 ${hub[0]} ${hub[1]}`,
              dur: "6s",
              repeatCount: "indefinite",
            })
          : ""),
    ) +
    tag("circle", { cx: hub[0], cy: hub[1], r: 3.5, fill: INK })
  );
}

function well(f: Foot, p: Paint): string {
  const { x, y, w, d } = f;
  const inner = { x: x + 0.15, y: y + 0.15, w: w - 0.3, d: d - 0.3 };
  const water = [
    proj(x + 0.25, y + 0.25, 12),
    proj(x + w - 0.25, y + 0.25, 12),
    proj(x + w - 0.25, y + d - 0.25, 12),
    proj(x + 0.25, y + d - 0.25, 12),
  ];
  return box(inner, 0, 12, "#c9b892", p) + poly(water, p("#2a7a7d"));
}

function gate(f: Foot, p: Paint): string {
  const { x, y, w, d } = f;
  const mid = y + d * 0.3;
  const post = (px: number) =>
    box({ x: px, y: mid, w: 0.2, d: d * 0.4 }, 0, 42, "#ded3bd", p);
  return (
    post(x) +
    post(x + w - 0.2) +
    box({ x, y: mid, w, d: d * 0.4 }, 32, 12, "#d6cbb2", p)
  );
}

function structure(
  d: District,
  tile: Tile,
  f: Foot,
  p: Paint,
  animate: boolean,
): string {
  switch (d.building) {
    case "academy":
    case "studio":
    case "shop": {
      const [x, y] = iso(tile[0], tile[1]);
      const href = `#${houseId(d.building, d.level, p === FADED)}`;
      return tag("use", { href, x, y });
    }
    case "core":
      return core(d, f, p);
    case "tent":
      return tent(f, p, false);
    case "camp":
      return tent(f, p, true);
    case "well":
      return well(f, p);
    case "windmill":
      return windmill(f, p, animate);
    case "gate":
      return gate(f, p);
  }
}

/**
 * 可點的建築群組：鍵盤可聚焦（tabindex=0）、role=button、aria-label，
 * 第一個子元素是 `<title>`（滑鼠停留提示＋螢幕閱讀器名稱）。
 */
export function pressable(
  attrs: Record<string, string | number>,
  name: string,
  inner: string,
): string {
  return tag(
    "g",
    { ...attrs, tabindex: 0, role: "button", "aria-label": name },
    tag("title", {}, escapeXml(name)) + inner,
  );
}

const STATE_WORD: Record<District["state"], string> = {
  building: "在建",
  waiting: "等你動手",
  auto: "自動運轉",
  dormant: "休眠",
};

/** 街區的無障礙名稱：名稱、狀態、Lv、有沒有任務。 */
export function districtName(d: District): string {
  const lv =
    d.state === "building" || d.state === "waiting" ? `，Lv.${d.level}` : "";
  const quest = d.state === "waiting" ? "，有任務等你接" : "";
  return `${d.name}：${STATE_WORD[d.state]}${lv}${quest}`;
}

/** 選中環；預設 display=none，頁面 CSS 的 .sel 才顯示。 */
export function ring(c: Pt, rx = 70, ry = 36, color = "#e3a12f"): string {
  return tag("ellipse", {
    class: "ring",
    display: "none",
    cx: c[0],
    cy: c[1] + 4,
    rx,
    ry,
    fill: "none",
    stroke: color,
    "stroke-width": 3,
    "stroke-dasharray": "7 5",
  });
}

/**
 * 休眠＝實心褪色（不用半透明）；施工中＝實心方塊加鷹架線。
 * 書院／工作室／商行輸出 `<use href="#a2">`，symbol 由 defs.ts 依用到的 id 產生。
 */
export function drawDistrict(d: District, tile: Tile, animate = true): string {
  const p = d.state === "dormant" ? FADED : SOLID;
  const body = structure(d, tile, footprint(tile), p, animate);
  return pressable(
    { class: "b", "data-id": d.id },
    districtName(d),
    ring(centerOf(tile)) + body,
  );
}

interface LandmarkSpec {
  /** 牆高、尖頂高與旗桿高 */
  wall: number;
  peak: number;
  /** 總高度＝牆＋尖頂＋旗 */
  top: number;
  rows: number;
  /** 尖頂＋旗的高度 */
  roof: number;
}

export const FLAG = 22;
const spec = (wall: number, peak: number, rows: number): LandmarkSpec => ({
  wall,
  peak,
  top: wall + peak + FLAG,
  rows,
  roof: peak + FLAG,
});

/** 目標地標佔 2×2 格；塔比書院高（比例對照 mock：塔尖頂 70）。 */
export const LANDMARK_SPEC: Record<Landmark, LandmarkSpec> = {
  academy: spec(64, 48, 3),
  tower: spec(96, 70, 4),
};
export const LANDMARK_SIZE = 2;

/** 地標精靈的 symbol id；屋頂與旗子用 currentColor，由 `<use color>` 換成目標色。 */
export const LANDMARK_ID: Record<Landmark, string> = {
  academy: "lmA",
  tower: "lmT",
};

export function drawLandmark(
  id: string,
  landmark: Landmark,
  color: string,
  tile: Tile,
  name = "目標",
): string {
  const f = footprint(tile, LANDMARK_SIZE);
  const [x, y] = iso(tile[0], tile[1]);
  const body = tag("use", { href: `#${LANDMARK_ID[landmark]}`, x, y, color });
  const ringAt = proj(f.x + f.w / 2, f.y + f.d / 2);
  return pressable(
    { class: "b", "data-id": id },
    `目標：${name}`,
    ring(ringAt, 92, 46) + body,
  );
}
