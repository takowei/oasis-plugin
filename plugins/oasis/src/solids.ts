import { INK, type Pt, mix, proj, pts, shade, tag } from "./geom.ts";

/** 建築共用的立體零件：全部以磁磚座標＋高度 z 作畫，底邊一定落在自己的格子內。 */

export type Tile = [number, number];
export type Paint = (hex: string) => string;

/** 休眠建築褪成實心的淡灰，不用半透明。 */
const DORMANT_GREY = "#cfc8bb";
export const SOLID: Paint = (hex) => hex;
export const FADED: Paint = (hex) => mix(hex, DORMANT_GREY, 0.65);

/** 建築底面離格線內縮多少（磁磚單位）；底邊仍在格內。 */
export const INSET = 0.12;
/** 光從左上來：影子往右下，每 70px 高度拖 1 格。 */
const SHADOW_PER_PX = 1 / 70;
export const SHADOW_OPACITY = 0.2;

export interface Foot {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** size×size 格的建築底面（內縮後）。 */
export function footprint([tx, ty]: Tile, size = 1): Foot {
  const side = size - 2 * INSET;
  return { x: tx + INSET, y: ty + INSET, w: side, d: side };
}

/** 建築佔用的整數格。 */
export function cellsOf([tx, ty]: Tile, size = 1): Tile[] {
  const cells: Tile[] = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) cells.push([tx + x, ty + y]);
  return cells;
}

const STROKE = { stroke: INK, "stroke-width": 1.4, "stroke-linejoin": "round" };

export function poly(
  points: Pt[],
  fill: string,
  extra: Record<string, string | number> = {},
): string {
  return tag("polygon", { points: pts(points), fill, ...STROKE, ...extra });
}

export function seg(a: Pt, b: Pt, attrs: Record<string, string | number>) {
  return tag("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...attrs });
}

/** 立體零件三個面的填色；可給 `url(#aL)` 這類漸層或 `currentColor`，沒給的面照舊用 shade。 */
export interface Fills {
  left?: string;
  right?: string;
  top?: string;
}

export function box(
  f: Foot,
  z: number,
  h: number,
  color: string,
  p: Paint = SOLID,
  fills: Fills = {},
): string {
  const { x, y, w, d } = f;
  const c = p(color);
  const top = (px: number, py: number) => proj(px, py, z + h);
  const base = (px: number, py: number) => proj(px, py, z);
  return (
    poly(
      [base(x, y + d), base(x + w, y + d), top(x + w, y + d), top(x, y + d)],
      fills.left ?? shade(c, 0.9),
    ) +
    poly(
      [base(x + w, y + d), base(x + w, y), top(x + w, y), top(x + w, y + d)],
      fills.right ?? shade(c, 0.72),
    ) +
    poly(
      [top(x, y), top(x + w, y), top(x + w, y + d), top(x, y + d)],
      fills.top ?? c,
    )
  );
}

/** 四角錐屋頂（尖頂）；底在高度 z、尖端在 z+peak。 */
export function pyramid(
  f: Foot,
  z: number,
  peak: number,
  color: string,
  p: Paint = SOLID,
  fills: Fills = {},
): string {
  const { x, y, w, d } = f;
  const apex = proj(x + w / 2, y + d / 2, z + peak);
  const L = proj(x, y + d, z);
  const F = proj(x + w, y + d, z);
  const R = proj(x + w, y, z);
  const face = (side: "left" | "right", k: number) =>
    fills[side] ?? shade(p(color), k);
  return (
    poly([L, F, apex], face("left", 0.92)) +
    poly([F, R, apex], face("right", 0.72))
  );
}

/** 右側牆面上的窗，rows 排。 */
export function windows(f: Foot, h: number, rows: number): string {
  const { x, y, w, d } = f;
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (const t of [0.3, 0.7]) {
      const z = h - 14 - r * 20;
      const yy = y + d - t * d;
      out += poly(
        [
          proj(x + w, yy - 0.08, z),
          proj(x + w, yy + 0.08, z),
          proj(x + w, yy + 0.08, z - 9),
          proj(x + w, yy - 0.08, z - 9),
        ],
        "#ffd98a",
        { "stroke-width": 0.8 },
      );
    }
  }
  return out;
}

/** 地面影子：底面往右下拖長，固定透明度。 */
export function shadow(f: Foot, height: number): string {
  const s = height * SHADOW_PER_PX;
  const [vx, vy] = [s, s * 0.25];
  const { x, y, w, d } = f;
  const ring: Pt[] = [
    proj(x, y),
    proj(x + w, y),
    proj(x + w + vx, y + vy),
    proj(x + w + vx, y + d + vy),
    proj(x + vx, y + d + vy),
    proj(x, y + d),
  ];
  return tag("polygon", {
    points: pts(ring),
    fill: INK,
    opacity: SHADOW_OPACITY,
  });
}
