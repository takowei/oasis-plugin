export const TW = 40;
export const TH = 20;
export const INK = "#17262b";

export type Pt = [number, number];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 磁磚座標 → 畫面座標（等角投影，磁磚上緣頂點）。 */
export const iso = (x: number, y: number): Pt => [(x - y) * TW, (x + y) * TH];

/** 磁磚座標（可帶小數）＋高度 z → 畫面座標；z 往上為正。 */
export const proj = (x: number, y: number, z = 0): Pt => [
  (x - y) * TW,
  (x + y) * TH - z,
];

const num = (n: number): string => String(Math.round(n * 10) / 10);

export const pts = (points: Pt[]): string =>
  points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");

export function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v * factor))),
  );
  return `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** a 往 b 混合 t（0–1）；用來把休眠建築褪色成實心的淡色。 */
export function mix(a: string, b: string, t: number): string {
  const ch = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const [ca, cb] = [ch(a), ch(b)];
  const out = ca.map((v, i) => Math.round(v + ((cb[i] as number) - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.x 相對亮度（sRGB #rrggbb）。 */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 對比值（1–21）。 */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA 一般文字門檻。 */
export const AA = 4.5;

/** 把底色一步步壓暗，直到和 text 的對比達到 ratio（預設 AA 4.5）；本來就夠就原樣回傳。 */
export function darkenForAA(hex: string, text = "#ffffff", ratio = AA): string {
  let out = hex.toLowerCase();
  for (let f = 1; contrast(out, text) < ratio && f > 0; f -= 0.02) {
    out = shade(hex, Math.max(0, f));
  }
  return out;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Attrs = Record<string, string | number>;

export function tag(name: string, attrs: Attrs, inner = ""): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? num(v) : escapeXml(v)}"`)
    .join("");
  return `<${name}${a}>${inner}</${name}>`;
}

const WIDE = /[^\u0000-ÿ]/;

export const QUEST_W = 24;
/** Lv 膠囊 36×18，左右各留 3 */
export const LV_W = 42;
export const LV_PILL = { w: 36, h: 18 } as const;
/** 文字字級：建築名稱／Lv／「!」／圖例 */
export const FONT = { name: 14, lv: 13, quest: 13, legend: 13 } as const;
/** 標籤膠囊高 */
export const PILL_H = 26;

/** 標籤膠囊寬度（含左右留白）；字級 14：CJK 14、其他 8.4 per char；「！」與 Lv 收在膠囊裡各加一段。 */
export function pillWidth(text: string, quest = false, lv = false): number {
  let w = 18 + (quest ? QUEST_W : 0) + (lv ? LV_W : 0);
  for (const ch of text) w += WIDE.test(ch) ? 14 : 8.4;
  return w;
}

/** 超過 maxEm 個全形字就截斷加「…」。 */
export function fitText(text: string, maxEm = 8): string {
  let out = "";
  let em = 0;
  for (const ch of text) {
    em += WIDE.test(ch) ? 1 : 0.58;
    if (em > maxEm) return `${out}…`;
    out += ch;
  }
  return out;
}

export function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x0 < b.x1 + pad &&
    b.x0 < a.x1 + pad &&
    a.y0 < b.y1 + pad &&
    b.y0 < a.y1 + pad
  );
}

export function union(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}
