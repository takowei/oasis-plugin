import { INK, type Pt, escapeXml, iso, pts, shade, tag } from "./geom.ts";
import { pressable } from "./sprites.ts";

const STONE = "#d8c7a0";
const STROKE = { stroke: INK, "stroke-width": 1.2, "stroke-linejoin": "round" };

/** 立方體（x、y 為磁磚座標，h 為畫面高度）；回傳 SVG 與頂面中心。 */
function block(
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  color: string,
): string {
  const up = (p: Pt): Pt => [p[0], p[1] - h];
  const T = iso(x, y);
  const R = iso(x + w, y);
  const F = iso(x + w, y + d);
  const L = iso(x, y + d);
  return (
    tag("polygon", {
      points: pts([L, F, up(F), up(L)]),
      fill: shade(color, 0.86),
      ...STROKE,
    }) +
    tag("polygon", {
      points: pts([F, R, up(R), up(F)]),
      fill: shade(color, 0.7),
      ...STROKE,
    }) +
    tag("polygon", {
      points: pts([up(T), up(R), up(F), up(L)]),
      fill: color,
      ...STROKE,
    })
  );
}

const WALL_H = 20;
const MERLON_H = 7;
const OUT = -0.5;

/** 沿一條邊畫矮牆和垛口；alongX=true 沿 x 方向（y 固定在 OUT）。 */
function wallRun(n: number, alongX: boolean): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += alongX
      ? block(i, OUT, 1, 0.4, WALL_H, STONE)
      : block(OUT, i, 0.4, 1, WALL_H, STONE);
  }
  const lift = { transform: `translate(0 ${-WALL_H})` };
  for (let i = 0; i < n; i++) {
    const at = i + 0.3;
    out += tag(
      "g",
      lift,
      alongX
        ? block(at, OUT + 0.1, 0.4, 0.2, MERLON_H, STONE)
        : block(OUT + 0.1, at, 0.2, 0.4, MERLON_H, STONE),
    );
  }
  return out;
}

function tower(x: number, y: number, flagged: boolean, count: number): string {
  const body = block(x, y, 1, 1, 70, STONE);
  const [tx, ty] = iso(x + 0.5, y + 0.5);
  const top = ty - 70;
  const roof = tag("polygon", {
    points: pts([
      [tx - 36, top + 2],
      [tx + 36, top + 2],
      [tx, top - 34],
    ]),
    fill: flagged ? "#b4442f" : "#8a6d3b",
    ...STROKE,
  });
  const pole = tag("path", {
    d: `M${tx} ${top - 34} v-20`,
    stroke: INK,
    "stroke-width": 1.8,
  });
  const flag = tag("path", {
    d: `M${tx} ${top - 54} l20 6 l-20 6z`,
    fill: flagged ? "#b4442f" : "#2f6b4f",
    ...STROKE,
  });
  const badge = flagged
    ? tag("circle", {
        cx: tx + 26,
        cy: top + 24,
        r: 12,
        fill: "#b4442f",
        ...STROKE,
      }) +
      tag(
        "text",
        {
          x: tx + 26,
          y: top + 28.5,
          "text-anchor": "middle",
          "font-size": count > 99 ? 9 : 12,
          "font-weight": 700,
          fill: "#fff",
        },
        escapeXml(String(count)),
      )
    : "";
  return body + roof + pole + flag + badge;
}

/** 城牆守衛：沿地圖後方兩邊的矮牆，三座塔；主塔（左）可點開警報面板。 */
export function drawWall(n: number, total: number): string {
  const flagged = total > 0;
  const walls = wallRun(n, true) + wallRun(n, false);
  const right = tower(n - 0.1, -0.9, false, 0);
  const main = pressable(
    { class: "b", "data-id": "guard" },
    `城牆守衛：共 ${total} 次警報`,
    tower(-0.9, n - 0.1, flagged, total),
  );
  /** 牆身與右塔只是裝飾，對輔助技術隱藏；主塔是按鈕。 */
  const deco = tag("g", { "aria-hidden": "true" }, walls + right);
  return tag("g", { class: "wall" }, deco + main);
}
