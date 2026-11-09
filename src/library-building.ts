import { INK, proj, shade, tag } from "./geom.ts";
import type { Item } from "./layout.ts";
import { box, footprint, poly, seg } from "./solids.ts";
import { centerOf, pressable, ring } from "./sprites.ts";
import type { Model } from "./types.ts";

/**
 * 圖書館外觀隨條目數（學到的事＋技能）成長：
 * 1–5 條＝小屋、6–15 條＝加高、16 條以上＝再加圓頂。
 * 0 條不蓋；門檻是「達到這個數量就升級」。
 */
export const LIBRARY_TIERS = [1, 6, 16] as const;

const WALL = "#e9dfc9";
const ROOF = "#6b4f8f";
const WALL_HEIGHT = [0, 24, 30, 34] as const;
const RIDGE = 20;

export function libraryCount(model: Model): number {
  return (model.learned?.length ?? 0) + (model.skills?.length ?? 0);
}

/** 1–3；0 條回 0（不蓋）。 */
export function libraryLevel(count: number): number {
  return LIBRARY_TIERS.filter((t) => count >= t).length;
}

/** 圖書館最高點離地面多少 px（含圓頂）。 */
export function libraryHeight(level: number): number {
  const wall = WALL_HEIGHT[level] ?? WALL_HEIGHT[1];
  return wall + RIDGE + (level >= 3 ? 12 : 0);
}

/** 屋頂（含圓頂）高度。 */
export const LIBRARY_ROOF = RIDGE + 12;

/** 人字屋頂：屋脊沿 x 方向，右側牆是山牆三角形。 */
function gableBody(level: number, tile: [number, number]): string {
  const f = footprint(tile);
  const { x, y, w, d } = f;
  const h = WALL_HEIGHT[level] ?? WALL_HEIGHT[1];
  const ym = y + d / 2;
  const over = 0.06;
  const columns = [0.25, 0.5, 0.75].map((t) =>
    seg(proj(x + t * w, y + d, 2), proj(x + t * w, y + d, h - 4), {
      stroke: shade(WALL, 0.7),
      "stroke-width": 3,
    }),
  );
  const gable = poly(
    [proj(x + w, y, h), proj(x + w, y + d, h), proj(x + w, ym, h + RIDGE)],
    shade(WALL, 0.72),
  );
  const slope = poly(
    [
      proj(x - over, y + d + over, h - 2),
      proj(x + w + over, y + d + over, h - 2),
      proj(x + w + over, ym, h + RIDGE),
      proj(x - over, ym, h + RIDGE),
    ],
    shade(ROOF, 0.95),
  );
  const dome =
    level >= 3
      ? (([cx, cy]) =>
          tag("path", {
            d: `M${cx - 14} ${cy} a14 12 0 0 1 28 0z`,
            fill: shade(ROOF, 1.25),
            stroke: INK,
            "stroke-width": 1.4,
          }))(proj(x + w / 2, ym, h + RIDGE))
      : "";
  return box(f, 0, h, WALL) + columns.join("") + gable + slope + dome;
}

/** 圖書館：蓋在主地面的一格上；點擊切換到右側「圖書館」面板。 */
export function drawLibrary(item: Item): string {
  const level = item.library ?? 1;
  return pressable(
    {
      class: "b library",
      "data-id": "library",
      "data-level": level,
    },
    `圖書館：Lv.${level}`,
    ring(centerOf(item.tile), 56, 28, ROOF) + gableBody(level, item.tile),
  );
}
