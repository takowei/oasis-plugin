import { ENDGAME_COLOR } from "./model.ts";
import {
  type Rect,
  TH,
  TW,
  PILL_H,
  fitText,
  intersects,
  pillWidth,
  proj,
  union,
} from "./geom.ts";
import {
  LIBRARY_ROOF,
  libraryCount,
  libraryHeight,
  libraryLevel,
} from "./library-building.ts";
import { CLOCK_HEIGHT, CLOCK_ROOF } from "./clock-building.ts";
import { cellsOf, footprint } from "./solids.ts";
import {
  LANDMARK_SIZE,
  LANDMARK_SPEC,
  centerOf,
  heightOf,
  roofOf,
} from "./sprites.ts";
import { CORE, type District, type Goal, type Model } from "./types.ts";

export type Tile = [number, number];

export const MIN_GRID = 11;
const MAX_GRID = 60;
export const CORE_COLOR = "#1f6f78";
const HORIZON_TOP = -120;
/** 標籤膠囊底邊離建築最高點的距離＋半個膠囊高 */
const LABEL_RISE = 18;

export interface LabelSpec {
  text: string;
  cx: number;
  cy: number;
  w: number;
  dim: boolean;
  /** 目標地標的標籤用目標色填滿 */
  goalColor?: string;
  lv?: number;
  /** 等你動手：「！」收在膠囊左端 */
  quest?: boolean;
}

export interface Item {
  /** 對應 SVG 的 data-id 與右側面板 */
  id: string;
  tile: Tile;
  /** 建築佔用的整數格（含地標的 2×2）；不會壓到路格與水池 */
  cells: Tile[];
  /** 建築邊長（格）與最高點離地 px；影子與標籤高度用 */
  size: number;
  top: number;
  goal?: Goal;
  district?: District;
  /** 圖書館外觀等級（1–3）；只有圖書館有 */
  library?: number;
  /** 鐘樓（行程表入口）；有 時間/ 資料才有 */
  clock?: true;
  label: LabelSpec;
  sprite: Rect;
  /** 碰撞用：牆身（全寬）與屋頂（尖的一段，比較窄） */
  parts: Rect[];
  labelBox: Rect;
  /** sprite ∪ label：擺位碰撞用 */
  bbox: Rect;
}

export interface Route {
  /** 起點 item id；綠洲核心連向目標的主幹線是 "hub" */
  from: string;
  goalId: string;
  color: string;
  tiles: Tile[];
}

/** 一段同色中線：從 a 格中心連到相鄰的 b 格中心（同一條目標路上的連續兩格）。 */
export interface RoadLink {
  a: Tile;
  b: Tile;
  color: string;
}

export interface LegendEntry {
  x: number;
  y: number;
  w: number;
  color: string;
  /** 該目標道路中線的 stroke-dasharray；"none" 是實線 */
  dash: string;
  text: string;
}

/**
 * 道路中線樣式：每個目標一種，色盲或灰階下也分得出來。
 * 依圖例順序（目標卡順序，最後是綠洲核心）輪流取用。
 */
export const ROAD_DASHES = [
  "none",
  "10 6",
  "2 6",
  "14 5 3 5",
  "6 4",
  "18 6",
  "3 4 9 4",
] as const;

export interface Layout {
  n: number;
  hub: Tile;
  pool: Tile;
  items: Item[];
  roads: Map<string, string>;
  routes: Route[];
  links: RoadLink[];
  palms: Tile[];
  legend: LegendEntry[];
  /** 道路色 → stroke-dasharray（與圖例同步） */
  dashes: Map<string, string>;
  /** 有終點目標時的遠方宮殿佔位 */
  palace?: Rect;
  endgame?: Goal;
  view: Rect;
}

export const key = ([x, y]: Tile): string => `${x},${y}`;

interface Art {
  /** 邊長（格） */
  size: number;
  /** 最高點離地 px */
  top: number;
  /** 其中屋頂（尖的一段）高度 */
  roof: number;
}

function itemFor(
  id: string,
  tile: Tile,
  art: Art,
  label: Omit<LabelSpec, "cx" | "cy" | "w">,
  extra: Pick<Item, "goal" | "district" | "library" | "clock">,
): Item {
  const f = footprint(tile, art.size);
  const [cx, py] = proj(f.x + f.w / 2, f.y + f.d / 2);
  const half = ((f.w + f.d) / 2) * TW + 2;
  const sprite: Rect = {
    x0: cx - half,
    y0: py - art.top,
    x1: cx + half,
    y1: py + ((f.w + f.d) / 2) * TH + 1,
  };
  const wallTop = sprite.y0 + art.roof;
  const parts: Rect[] = [
    { ...sprite, y0: wallTop },
    { ...sprite, x0: cx - half / 2, x1: cx + half / 2, y1: wallTop },
  ];
  const w = pillWidth(label.text, label.quest === true, label.lv !== undefined);
  const cy = sprite.y0 - LABEL_RISE;
  const labelBox: Rect = {
    x0: cx - w / 2,
    y0: cy - PILL_H / 2,
    x1: cx + w / 2,
    y1: cy + PILL_H / 2,
  };
  return {
    id,
    tile,
    cells: cellsOf(tile, art.size),
    size: art.size,
    top: art.top,
    ...extra,
    label: { ...label, cx, cy, w },
    sprite,
    parts,
    labelBox,
    bbox: union(sprite, labelBox),
  };
}

function goalItem(goal: Goal, tile: Tile): Item {
  const spec = LANDMARK_SPEC[goal.landmark];
  return itemFor(
    `goal-${goal.id}`,
    tile,
    { size: LANDMARK_SIZE, top: spec.top, roof: spec.roof },
    {
      text: `目標：${fitText(goal.name, 10)}`,
      dim: false,
      goalColor: goal.color,
    },
    { goal },
  );
}

function districtItem(d: District, tile: Tile): Item {
  const showLv = d.state === "building" || d.state === "waiting";
  return itemFor(
    d.id,
    tile,
    { size: 1, top: heightOf(d), roof: roofOf(d) },
    {
      text: fitText(d.short ?? d.name, 10),
      dim: d.state === "dormant",
      lv: showLv ? d.level : undefined,
      quest: d.state === "waiting",
    },
    { district: d },
  );
}

function libraryItem(level: number, tile: Tile): Item {
  return itemFor(
    "library",
    tile,
    { size: 1, top: libraryHeight(level), roof: LIBRARY_ROOF },
    { text: "圖書館", dim: false, lv: level },
    { library: level },
  );
}

function clockItem(tile: Tile): Item {
  return itemFor(
    "clock",
    tile,
    { size: 1, top: CLOCK_HEIGHT, roof: CLOCK_ROOF },
    { text: "行程表", dim: false },
    { clock: true },
  );
}

/** 兩棟的建築身體、標籤都不互相重疊（標籤不蓋別棟建築，也不蓋別的標籤）。 */
export function collides(a: Item, b: Item): boolean {
  // 所有零件都在 bbox 內：bbox 不相交就不可能碰撞（快速排除，結果不變）。
  if (!intersects(a.bbox, b.bbox, 2)) return false;
  const hit = (x: Rect[], y: Rect[]) =>
    x.some((r) => y.some((q) => intersects(r, q, 2)));
  return (
    hit(a.parts, b.parts) ||
    hit([a.labelBox], [b.labelBox]) ||
    hit(a.parts, [b.labelBox]) ||
    hit([a.labelBox], b.parts)
  );
}

/** 建築之間至少留一格（路可以佔那格）。 */
function tooClose(a: Item, b: Item): boolean {
  // 底面都是從 tile 起算的 size×size 正方形：兩塊各外擴一格後重疊＝有格子相距 ≤1。
  const [ax, ay] = a.tile;
  const [bx, by] = b.tile;
  return (
    bx <= ax + a.size &&
    ax <= bx + b.size &&
    by <= ay + a.size &&
    ay <= by + b.size
  );
}

class Board {
  readonly items: Item[] = [];
  readonly occupied = new Set<string>();
  readonly hub: Tile;
  readonly pool = new Set<string>();

  constructor(
    readonly n: number,
    private readonly strict: boolean,
    private readonly palace: Rect | undefined,
  ) {
    const c = Math.floor(n / 2);
    this.hub = [c - 3, c - 3];
    for (const x of [c - 1, c])
      for (const y of [c - 1, c]) this.pool.add(key([x, y]));
    this.occupied.add(key(this.hub));
  }

  fits(item: Item): boolean {
    if (!this.strict) return true;
    if (this.palace && intersects(item.bbox, this.palace, 2)) return false;
    return !this.items.some((o) => collides(item, o) || tooClose(item, o));
  }

  add(item: Item): void {
    this.items.push(item);
    for (const cell of item.cells) this.occupied.add(key(cell));
  }

  /** 整塊底面都在地圖內、沒被佔用、也不是水池。 */
  cellsFree(cells: Tile[]): boolean {
    return cells.every(
      ([x, y]) =>
        x >= 0 && y >= 0 && x < this.n && y < this.n && this.free([x, y]),
    );
  }

  free(t: Tile): boolean {
    const k = key(t);
    return !this.occupied.has(k) && !this.pool.has(k);
  }

  /** 靠近 anchor 的第一個放得下的磁磚。 */
  placeNear(anchor: [number, number], make: (t: Tile) => Item): boolean {
    const candidates: Tile[] = [];
    for (let x = 1; x <= this.n - 2; x++) {
      for (let y = 1; y <= this.n - 2; y++) {
        if (this.free([x, y])) candidates.push([x, y]);
      }
    }
    const dist = ([x, y]: Tile) => Math.hypot(x - anchor[0], y - anchor[1]);
    candidates.sort((a, b) => dist(a) - dist(b) || a[0] - b[0] || a[1] - b[1]);
    for (const tile of candidates) {
      const item = make(tile);
      if (this.fits(item)) {
        this.add(item);
        return true;
      }
    }
    return false;
  }
}

/** 地標佔 2×2 格：先沿左、右後緣一路排開，排滿再往內一圈（每圈隔 2 格）。 */
function placeGoals(board: Board, goals: Goal[]): boolean {
  return goals.every((goal, i) => {
    for (let ring = 0; ring <= board.n - 3; ring += 2) {
      for (let o = 4; o <= board.n - 2; o++) {
        const tile: Tile = i % 2 === 0 ? [ring, o] : [o, ring];
        const item = goalItem(goal, tile);
        if (board.cellsFree(item.cells) && board.fits(item)) {
          board.add(item);
          return true;
        }
      }
    }
    return false;
  });
}

function goalTile(board: Board, goalId: string | undefined): Tile | undefined {
  if (goalId === CORE) return board.hub;
  return board.items.find((i) => i.goal?.id === goalId)?.tile;
}

function anchorFor(board: Board, d: District, byGoal: Tile | undefined) {
  const far = board.n - 1;
  const c = Math.floor(board.n / 2);
  if (d.state === "auto") return [2, board.n - 3] as [number, number];
  if (d.state === "dormant") return [board.n - 2, c + 1] as [number, number];
  if (byGoal && d.goal !== CORE) {
    return [
      byGoal[0] + 0.35 * (far - byGoal[0]),
      byGoal[1] + 0.35 * (far - byGoal[1]),
    ] as [number, number];
  }
  return [c + 1, far - 1] as [number, number];
}

function placeDistricts(board: Board, model: Model): boolean {
  const goalItems = new Map(
    model.goals.map((g) => [g.id, goalTile(board, g.id)]),
  );
  const hubOwner = model.districts.find(
    (d) => d.building === "core" && d.tile === undefined,
  );
  const manual = model.districts.filter((d) => d.tile !== undefined);
  for (const d of manual) board.add(districtItem(d, d.tile as Tile));
  if (hubOwner) {
    board.occupied.delete(key(board.hub));
    board.add(districtItem(hubOwner, board.hub));
  }
  const level = libraryLevel(libraryCount(model));
  if (level > 0) {
    const anchor: [number, number] = [board.n - 2, Math.floor(board.n / 2) - 1];
    if (!board.placeNear(anchor, (t) => libraryItem(level, t))) return false;
  }
  if (model.schedule) {
    const c = Math.floor(board.n / 2);
    if (!board.placeNear([c + 2, c - 2], clockItem)) return false;
  }
  const order = ["building", "waiting", "auto", "dormant"];
  const rest = model.districts
    .filter((d) => d !== hubOwner && d.tile === undefined)
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return rest.every((d) => {
    const anchor = anchorFor(board, d, goalItems.get(d.goal ?? ""));
    return board.placeNear(anchor, (t) => districtItem(d, t));
  });
}

interface Edge {
  tiles: Tile[];
}

function cheapestPath(
  n: number,
  from: Tile,
  to: Tile,
  cost: (t: Tile) => number,
): Edge {
  const idx = (t: Tile) => t[0] * n + t[1];
  const dist = new Array<number>(n * n).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n * n).fill(-1);
  const done = new Array<boolean>(n * n).fill(false);
  dist[idx(from)] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < dist.length; i++) {
      if (
        !done[i] &&
        (best < 0 || (dist[i] as number) < (dist[best] as number))
      ) {
        best = i;
      }
    }
    if (best < 0 || !Number.isFinite(dist[best])) break;
    done[best] = true;
    if (best === idx(to)) break;
    const x = Math.floor(best / n);
    const y = best % n;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Tile[]) {
      const t: Tile = [x + dx, y + dy];
      if (t[0] < 0 || t[1] < 0 || t[0] >= n || t[1] >= n) continue;
      const total = (dist[best] as number) + cost(t);
      if (total < (dist[idx(t)] as number)) {
        dist[idx(t)] = total;
        prev[idx(t)] = best;
      }
    }
  }
  const tiles: Tile[] = [];
  for (let at = idx(to); at !== -1; at = prev[at] as number) {
    tiles.unshift([Math.floor(at / n), at % n]);
  }
  return { tiles };
}

interface Link {
  from: string;
  start: Tile;
  goalId: string;
  end: Tile;
  color: string;
}

function linksFor(board: Board, model: Model): Link[] {
  const links: Link[] = [];
  const hubOwner = board.items.find((i) => key(i.tile) === key(board.hub));
  if (hubOwner || model.districts.some((d) => d.goal === CORE)) {
    for (const g of model.goals.filter((g) => g.kind === "goal")) {
      const end = goalTile(board, g.id);
      if (end)
        links.push({
          from: "hub",
          start: board.hub,
          goalId: g.id,
          end,
          color: g.color,
        });
    }
  }
  for (const item of board.items) {
    const d = item.district;
    if (!d || d.goal === undefined || key(item.tile) === key(board.hub))
      continue;
    const end =
      d.goal === CORE
        ? board.hub
        : model.goals.find((g) => g.id === d.goal)?.kind === "endgame"
          ? ([0, 0] as Tile)
          : goalTile(board, d.goal);
    if (!end) continue;
    const goal = model.goals.find((g) => g.id === d.goal);
    const color = d.goal === CORE ? CORE_COLOR : (goal?.color ?? ENDGAME_COLOR);
    links.push({ from: item.id, start: item.tile, goalId: d.goal, end, color });
  }
  return links;
}

/** 別人的建築、水池幾乎不能穿過；自己兩端的建築底面可以（路到建築邊就停）。 */
const BLOCKED = 1000;

function cellsAt(board: Board, t: Tile): Tile[] {
  return board.items.find((i) => key(i.tile) === key(t))?.cells ?? [t];
}

function buildRoads(board: Board, links: Link[]) {
  const roads = new Map<string, string>();
  const routes: Route[] = [];
  const segments = new Map<string, RoadLink>();
  const built = new Set(board.items.flatMap((i) => i.cells.map(key)));
  for (const link of links) {
    const own = new Set(
      [...cellsAt(board, link.start), ...cellsAt(board, link.end)].map(key),
    );
    const cost = (t: Tile): number => {
      const k = key(t);
      if (own.has(k)) return 1;
      if (board.pool.has(k) || board.occupied.has(k)) return BLOCKED;
      const owner = roads.get(k);
      if (owner === link.color) return 0.25;
      return owner ? 8 : 1;
    };
    const { tiles } = cheapestPath(board.n, link.start, link.end, cost);
    const paved = tiles.filter((t) => !built.has(key(t)));
    const pavedKeys = new Set(paved.map(key));
    for (const t of paved)
      if (!roads.has(key(t))) roads.set(key(t), link.color);
    for (let i = 0; i + 1 < tiles.length; i++) {
      const [a, b] = [tiles[i] as Tile, tiles[i + 1] as Tile];
      if (!pavedKeys.has(key(a)) || !pavedKeys.has(key(b))) continue;
      const [lo, hi] = key(a) < key(b) ? [a, b] : [b, a];
      segments.set(`${key(lo)}|${key(hi)}|${link.color}`, {
        a: lo,
        b: hi,
        color: link.color,
      });
    }
    routes.push({
      from: link.from,
      goalId: link.goalId,
      color: link.color,
      tiles,
    });
  }
  return { roads, routes, links: [...segments.values()] };
}

const PALM_OFFSETS: [number, number][] = [
  [-1.4, 0.2],
  [1.4, -1.2],
  [0.8, 1.9],
  [-1.8, -1.1],
  [0.2, -2.6],
  [-1.2, 2.3],
];

function placePalms(board: Board, roads: Map<string, string>): Tile[] {
  const c = Math.floor(board.n / 2);
  const palms: Tile[] = [];
  for (const [dx, dy] of PALM_OFFSETS) {
    const tile: Tile = [Math.floor(c + dx), Math.floor(c + dy)];
    const [px, py] = centerOf(tile);
    const box: Rect = { x0: px - 24, y0: py - 44, x1: px + 24, y1: py + 20 };
    const blocked =
      !board.free(tile) ||
      roads.has(key(tile)) ||
      board.items.some((i) => intersects(box, i.bbox));
    if (!blocked) palms.push(tile);
  }
  return palms;
}

function legendFor(
  routes: Route[],
  model: Model,
  n: number,
): { legend: LegendEntry[]; bottom: number; dashes: Map<string, string> } {
  const names = new Map<
    string,
    { color: string; text: string; dash: string }
  >();
  const dashes = new Map<string, string>();
  const add = (id: string, color: string, text: string) => {
    if (!dashes.has(color))
      dashes.set(
        color,
        ROAD_DASHES[dashes.size % ROAD_DASHES.length] as string,
      );
    names.set(id, { color, text, dash: dashes.get(color) as string });
  };
  for (const g of model.goals) {
    const r = routes.find((x) => x.goalId === g.id);
    if (r) add(g.id, g.color, `通往 ${fitText(g.name, 10)}`);
  }
  const hasCore = model.districts.some((d) => d.building === "core");
  if (hasCore && routes.some((r) => r.goalId === CORE)) {
    add(CORE, CORE_COLOR, "接綠洲核心（自動運轉）");
  }
  const half = n * TW + 20;
  const maxRow = 2 * half - 48;
  const rows: { color: string; text: string; dash: string; w: number }[][] = [
    [],
  ];
  const rowWidth = (r: { w: number }[]) =>
    r.reduce((s, e) => s + e.w, 0) + 16 * Math.max(0, r.length - 1);
  for (const e of names.values()) {
    const entry = { ...e, w: pillWidth(e.text) + 12 };
    let last = rows[rows.length - 1] as (typeof rows)[number];
    if (last.length > 0 && rowWidth([...last, entry]) > maxRow) {
      last = [];
      rows.push(last);
    }
    last.push(entry);
  }
  const top = 2 * TH * n + 26;
  const legend: LegendEntry[] = [];
  rows.forEach((row, r) => {
    let x = -rowWidth(row) / 2;
    for (const e of row) {
      legend.push({ ...e, x, y: top + r * 28 });
      x += e.w + 16;
    }
  });
  return {
    legend,
    dashes,
    bottom: legend.length === 0 ? top - 14 : top + (rows.length - 1) * 28 + 22,
  };
}

function attempt(model: Model, n: number, strict: boolean): Layout | undefined {
  const endgame = model.goals.find((g) => g.kind === "endgame");
  const palace: Rect | undefined = endgame
    ? { x0: -40, y0: -95, x1: 40, y1: -30 }
    : undefined;
  const board = new Board(n, strict, palace);
  const goals = model.goals.filter((g) => g.kind === "goal");
  if (!placeGoals(board, goals) || !placeDistricts(board, model))
    return undefined;
  const { roads, routes, links } = buildRoads(board, linksFor(board, model));
  const { legend, bottom, dashes } = legendFor(routes, model, n);
  const half = n * TW + 20;
  const top = Math.min(HORIZON_TOP, ...board.items.map((i) => i.bbox.y0 - 10));
  const c = Math.floor(n / 2);
  return {
    n,
    hub: board.hub,
    pool: [c - 1, c - 1],
    items: board.items,
    roads,
    routes,
    links,
    palms: placePalms(board, roads),
    legend,
    dashes,
    palace,
    endgame,
    view: { x0: -half, y0: top, x1: half, y1: bottom + 8 },
  };
}

/** 從 11×11 起放，放不下就加大一格；到上限仍放不下就放棄碰撞檢查（不讓圖掛）。 */
export function computeLayout(model: Model): Layout {
  const tiles = model.districts.flatMap((d) => (d.tile ? [...d.tile] : []));
  const start = Math.max(MIN_GRID, Math.max(0, ...tiles) + 2);
  for (let n = Math.min(start, MAX_GRID); n < MAX_GRID; n++) {
    const layout = attempt(model, n, true);
    if (layout) return layout;
  }
  const last = attempt(model, MAX_GRID, false);
  if (!last) throw new Error("目標或街區太多，地圖放不下");
  return last;
}
