import { INK, proj, tag } from "./geom.ts";
import { box, footprint, poly, pyramid, seg } from "./solids.ts";
import type { Item } from "./layout.ts";
import { centerOf, pressable, ring } from "./sprites.ts";

/** 鐘樓：有 時間/ 資料才蓋，一格大、比圖書館高，頂上是錐形屋頂。 */
const WALL = "#d9c9a3";
const ROOF = "#2f6b8f";
const WALL_HEIGHT = 58;
const PEAK = 26;

/** 鐘樓最高點離地面多少 px。 */
export const CLOCK_HEIGHT = WALL_HEIGHT + PEAK;
/** 屋頂（尖的一段）高度。 */
export const CLOCK_ROOF = PEAK;

function face(tile: [number, number]): string {
  const f = footprint(tile);
  const [cx, cy] = proj(f.x + f.w / 2, f.y + f.d, WALL_HEIGHT - 18);
  const hand = (dx: number, dy: number) =>
    seg([cx, cy], [cx + dx, cy + dy], {
      stroke: INK,
      "stroke-width": 2,
      "stroke-linecap": "round",
    });
  return (
    tag("circle", {
      cx,
      cy,
      r: 9,
      fill: "#fffaf0",
      stroke: INK,
      "stroke-width": 1.6,
    }) +
    hand(0, -6) +
    hand(4, 2)
  );
}

/** 鐘樓：點擊切換到右側「行程表」面板。 */
export function drawClock(item: Item): string {
  const f = footprint(item.tile);
  const body = box(f, 0, WALL_HEIGHT, WALL) + face(item.tile);
  const roof = pyramid(f, WALL_HEIGHT, PEAK, ROOF);
  const flag = poly(
    [
      proj(f.x + f.w / 2, f.y + f.d / 2, CLOCK_HEIGHT),
      proj(f.x + f.w / 2, f.y + f.d / 2, CLOCK_HEIGHT + 10),
      proj(f.x + f.w / 2 + 0.2, f.y + f.d / 2, CLOCK_HEIGHT + 5),
    ],
    "#e3a12f",
  );
  return pressable(
    { class: "b clock", "data-id": "clock" },
    "鐘樓：打開這週的行程表",
    ring(centerOf(item.tile), 56, 28, ROOF) + body + roof + flag,
  );
}
