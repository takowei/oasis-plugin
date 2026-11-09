import {
  BUILDINGS,
  type BuildingKind,
  type Card,
  type CardError,
  CORE,
  type District,
  GOAL_KINDS,
  type Goal,
  type GoalKind,
  LANDMARKS,
  type Landmark,
  STATES,
  type State,
  type Xp,
} from "./types.ts";

type Fields = Record<string, string>;
type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const DECIMAL = /^\d+(\.\d+)?$/;
const GOAL_ID = /^[\p{L}\p{N}_-]+$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function unquote(raw: string): string {
  const v = raw.trim();
  const double = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(v);
  if (double) {
    return (double[1] as string).replace(/\\(["\\n])/g, (_, c: string) =>
      c === "n" ? "\n" : c,
    );
  }
  const single = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(v);
  if (single) return (single[1] as string).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, "");
}

/** 切出 frontmatter 與內文；只支援單層 `key: value`。 */
export function splitFrontmatter(
  text: string,
): Parsed<{ fields: Fields; body: string }> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { ok: false, reason: "開頭沒有 --- frontmatter" };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { ok: false, reason: "frontmatter 沒有結尾的 ---" };
  const fields: Fields = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m) return { ok: false, reason: `第 ${i + 1} 行無法解析：${line}` };
    fields[m[1] as string] = unquote(m[2] as string);
  }
  return {
    ok: true,
    value: {
      fields,
      body: lines
        .slice(end + 1)
        .join("\n")
        .trim(),
    },
  };
}

function isRealDate(iso: string): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return (
    ISO_DATE.test(iso) &&
    !Number.isNaN(t) &&
    new Date(t).toISOString().startsWith(iso)
  );
}

function optional(fields: Fields, key: string): string | undefined {
  const v = fields[key];
  return v === undefined || v === "" ? undefined : v;
}

function requireFields(fields: Fields): string | undefined {
  for (const key of ["name", "state", "next", "since"]) {
    if (!fields[key]) return `缺少必填欄位 ${key}`;
  }
  if (!STATES.includes(fields.state as State)) {
    return `state 必須是 ${STATES.join("｜")}，收到「${fields.state}」`;
  }
  if (!isRealDate(fields.since as string)) {
    return `since 不是有效的 ISO 日期（YYYY-MM-DD）：${fields.since}`;
  }
  return undefined;
}

function parseProgress(raw: string | undefined): Parsed<number | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const n = DECIMAL.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return { ok: false, reason: `progress 必須是 0–1 的數字：${raw}` };
  }
  return { ok: true, value: n };
}

const DEFAULT_BUILDING: Record<State, BuildingKind> = {
  building: "studio",
  waiting: "shop",
  auto: "well",
  dormant: "tent",
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const TILE = /^\[\s*(\d+)\s*,\s*(\d+)\s*\]$/;

function oneOf<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  key: string,
): Parsed<T | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (allowed.includes(raw as T)) return { ok: true, value: raw as T };
  return {
    ok: false,
    reason: `${key} 必須是 ${allowed.join("｜")}，收到「${raw}」`,
  };
}

function parseTile(
  raw: string | undefined,
): Parsed<[number, number] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const m = TILE.exec(raw);
  if (!m) return { ok: false, reason: `tile 必須是 [x, y]（整數）：${raw}` };
  return { ok: true, value: [Number(m[1]), Number(m[2])] };
}

/** 逗號分隔，但引號內的逗號不切。 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let current = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseXp(raw: string | undefined): Parsed<Xp | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const bad = (why: string): Parsed<Xp> => ({
    ok: false,
    reason: `xp 必須是 {current: 數字, target: 數字, label: 文字}：${why}`,
  });
  const m = /^\{(.*)\}$/.exec(raw.trim());
  if (!m) return bad(raw);
  const map: Fields = {};
  for (const part of splitTopLevel(m[1] as string)) {
    const kv = /^\s*([A-Za-z_]\w*)\s*:(.*)$/.exec(part);
    if (!kv) return bad(part.trim());
    map[kv[1] as string] = unquote(kv[2] as string);
  }
  const current = DECIMAL.test(map.current ?? "")
    ? Number(map.current)
    : Number.NaN;
  const target = DECIMAL.test(map.target ?? "")
    ? Number(map.target)
    : Number.NaN;
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    return bad("current／target 不是數字");
  }
  if (current < 0 || target <= 0) return bad("current ≥ 0、target > 0");
  return { ok: true, value: { current, target, label: map.label ?? "" } };
}

/** 沒填 level 時由 progress 推：<⅓ 為 1、<⅔ 為 2、其餘 3；都沒有就 1。 */
export function levelFromProgress(progress: number | undefined): number {
  if (progress === undefined) return 1;
  return progress < 1 / 3 ? 1 : progress < 2 / 3 ? 2 : 3;
}

function parseLevel(
  raw: string | undefined,
  progress: number | undefined,
): Parsed<number> {
  if (raw === undefined)
    return { ok: true, value: levelFromProgress(progress) };
  if (!/^[123]$/.test(raw)) {
    return { ok: false, reason: `level 必須是 1、2、3：${raw}` };
  }
  return { ok: true, value: Number(raw) };
}

function fileId(file: string): string {
  return file.replace(/\.md$/, "").replace(/[^\p{L}\p{N}_-]/gu, "_");
}

export function parseCard(card: Card): District | CardError {
  const fail = (reason: string): CardError => ({ file: card.file, reason });
  const split = splitFrontmatter(card.text);
  if (!split.ok) return fail(split.reason);
  const { fields, body } = split.value;
  const problem = requireFields(fields);
  if (problem) return fail(problem);
  const progress = parseProgress(optional(fields, "progress"));
  const building = oneOf(optional(fields, "building"), BUILDINGS, "building");
  const level = parseLevel(
    optional(fields, "level"),
    progress.ok ? progress.value : undefined,
  );
  const xp = parseXp(optional(fields, "xp"));
  const tile = parseTile(optional(fields, "tile"));
  for (const r of [progress, building, level, xp, tile]) {
    if (!r.ok) return fail(r.reason);
  }
  const state = fields.state as State;
  const goal =
    optional(fields, "goal") ?? (state === "auto" ? CORE : undefined);
  return {
    file: card.file,
    id: fileId(card.file),
    name: fields.name as string,
    short: optional(fields, "short"),
    state,
    next: fields.next as string,
    since: fields.since as string,
    due: optional(fields, "due"),
    progress: progress.ok ? progress.value : undefined,
    statusText: optional(fields, "status_text"),
    goal,
    building: (building.ok && building.value) || DEFAULT_BUILDING[state],
    level: level.ok ? level.value : 1,
    xp: xp.ok ? xp.value : undefined,
    quest: optional(fields, "quest"),
    tile: tile.ok ? tile.value : undefined,
    body,
  };
}

/** 目標卡；color 沒填時先給空字串，由 buildModel 依序配色。 */
export function parseGoal(card: Card): Goal | CardError {
  const fail = (reason: string): CardError => ({ file: card.file, reason });
  const split = splitFrontmatter(card.text);
  if (!split.ok) return fail(split.reason);
  const { fields, body } = split.value;
  for (const key of ["id", "name", "kind"]) {
    if (!fields[key]) return fail(`缺少必填欄位 ${key}`);
  }
  if (!GOAL_ID.test(fields.id as string)) {
    return fail(`id 只能用文字、數字、底線、連字號：${fields.id}`);
  }
  if (fields.id === CORE) return fail(`id 不能用保留字 ${CORE}`);
  const kind = oneOf(fields.kind, GOAL_KINDS, "kind");
  const landmark = oneOf(optional(fields, "landmark"), LANDMARKS, "landmark");
  if (!kind.ok) return fail(kind.reason);
  if (!landmark.ok) return fail(landmark.reason);
  const color = optional(fields, "color") ?? "";
  if (color !== "" && !HEX_COLOR.test(color)) {
    return fail(`color 必須是 #rrggbb：${color}`);
  }
  return {
    file: card.file,
    id: fields.id as string,
    name: fields.name as string,
    kind: kind.value as GoalKind,
    color,
    landmark: (landmark.value ?? "academy") as Landmark,
    body,
  };
}

export function isCardError<T extends object>(
  x: T | CardError,
): x is CardError {
  return "reason" in x;
}
