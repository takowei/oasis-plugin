import { isCardError, parseCard, parseGoal } from "./parse.ts";
import {
  CORE,
  type Card,
  type District,
  type Goal,
  MAX_GOALS,
  type Model,
  TILE_MAX,
  TILE_MIN,
} from "./types.ts";

export const GOAL_PALETTE = [
  "#4f8fb0",
  "#d98c2b",
  "#8a63b8",
  "#3f9d6b",
  "#c4506b",
  "#7a8a2e",
];
export const ENDGAME_COLOR = "#8a7a5a";

function byFile<T extends { file: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.file.localeCompare(b.file));
}

function paint(goals: Goal[]): Goal[] {
  let next = 0;
  return goals.map((g) => {
    if (g.color !== "") return g;
    if (g.kind === "endgame") return { ...g, color: ENDGAME_COLOR };
    const color = GOAL_PALETTE[next++ % GOAL_PALETTE.length] as string;
    return { ...g, color };
  });
}

function orphanReason(goal: string | undefined, ids: Set<string>): string {
  if (goal === undefined) return "沒有 goal";
  return ids.has(goal) ? "" : `goal「${goal}」不存在`;
}

function uniqueIds(districts: District[], goals: Goal[]): District[] {
  const used = new Set(goals.map((g) => `goal-${g.id}`));
  return districts.map((d) => {
    let id = d.id;
    for (let n = 2; used.has(id); n++) id = `${d.id}-${n}`;
    used.add(id);
    return { ...d, id };
  });
}

function validTile(tile: [number, number]): boolean {
  return tile.every((v) => v >= TILE_MIN && v <= TILE_MAX);
}

/** 越界或和先到者撞格的手動 tile 一律忽略（改自動擺位），並記警告。 */
function checkTiles(districts: District[], warnings: Model["warnings"]) {
  const taken = new Set<string>();
  return districts.map((d) => {
    if (d.tile === undefined) return d;
    const key = d.tile.join(",");
    const why = !validTile(d.tile)
      ? `tile [${key}] 超出地圖（${TILE_MIN}–${TILE_MAX}）`
      : taken.has(key)
        ? `tile [${key}] 已被別張卡佔用`
        : "";
    if (why === "") {
      taken.add(key);
      return d;
    }
    warnings.push({ file: d.file, reason: `${why}，已忽略改自動擺位` });
    return { ...d, tile: undefined };
  });
}

/** 依檔名排序後逐張解析；壞卡進 errors，不影響其他卡。 */
export function buildModel(cards: Card[], goalCards: Card[] = []): Model {
  const model: Model = {
    goals: [],
    districts: [],
    errors: [],
    orphans: [],
    warnings: [],
  };
  const goals: Goal[] = [];
  for (const card of byFile(goalCards)) {
    const result = parseGoal(card);
    if (isCardError(result)) model.errors.push(result);
    else if (goals.length >= MAX_GOALS) {
      model.errors.push({
        file: card.file,
        reason: `目標超過 ${MAX_GOALS} 張，這張不畫`,
      });
    } else if (goals.some((g) => g.id === result.id)) {
      model.errors.push({ file: card.file, reason: `id「${result.id}」重複` });
    } else goals.push(result);
  }
  model.goals = paint(goals);
  for (const card of byFile(cards)) {
    const result = parseCard(card);
    if (isCardError(result)) model.errors.push(result);
    else model.districts.push(result);
  }
  model.districts = checkTiles(
    uniqueIds(model.districts, model.goals),
    model.warnings,
  );
  const ids = new Set([CORE, ...model.goals.map((g) => g.id)]);
  for (const d of model.districts) {
    if (d.state !== "building" && d.state !== "waiting") continue;
    if (d.building === "core") continue;
    const reason = orphanReason(d.goal, ids);
    if (reason !== "") {
      model.orphans.push({ file: d.file, name: d.name, reason });
    }
  }
  return model;
}

const DAY_MS = 86_400_000;

/** 從 since（ISO 日期）到 today（本地日曆日）的整天數，最小 0。 */
export function daysSince(since: string, today: Date): number {
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const days = Math.round(
    (todayUtc - Date.parse(`${since}T00:00:00Z`)) / DAY_MS,
  );
  return Math.max(0, days);
}
