import { escapeXml as esc } from "./geom.ts";
import { scheduleClient } from "./schedule-client.ts";
import { type SData, scheduleLib } from "./schedule-lib.ts";
import {
  DAY_MINUTES,
  DAY_NAMES,
  type Schedule,
  STATUS_SYMBOL,
  STATUS_WORD,
  formatTime,
  segmentsOn,
  weekCounts,
  weekDayOf,
  weekdayIndex,
} from "./schedule.ts";
import type { Model } from "./types.ts";

/** 行程表面板與鐘樓晶片的樣式（併進頁面 STYLE）。窄螢幕（< 600px）改成直式清單。 */
export const SCHEDULE_STYLE = `
.stage:has(.pane.sched:not([hidden])){grid-template-columns:1fr}
.stage:has(.pane.sched:not([hidden])) aside{order:-1}
.week{display:grid;grid-template-columns:repeat(7,minmax(122px,1fr));gap:8px;margin-top:12px;overflow-x:auto}
.day{border:2px solid var(--ink);border-radius:10px;padding:6px 8px;background:#fff;min-width:0}
.day h3{font-size:14px;display:flex;justify-content:space-between;gap:6px}
.day.today{border-width:4px;background:#fff8e6}
.day.today h3 em{background:var(--ink);color:#fff;font-style:normal;border-radius:6px;padding:0 6px;font-size:12px}
.day ul{list-style:none;padding:0;margin-top:6px;display:grid;gap:4px}
.day li{border:2px solid var(--ink);border-radius:6px;padding:2px 6px;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
.day li.fx{background:#e4e0d6;border-color:#8a8678;color:#3b3a35}
.day li.free{border-style:dashed;border-color:#8a8678;color:var(--ink-soft);background:none}
.day li.tk.done{background:#d9eddc}
.day li.tk.todo{background:#fff0c2}
.day li.tk.moved{background:#dce7f6;font-style:italic}
.day li.tk.dropped{background:#f2f2f2;color:var(--ink-soft);text-decoration:line-through}
.day li b{font-weight:700;margin-right:4px}
.day li button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;cursor:pointer;text-decoration:underline}
.day li button:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.sched .legend{margin-top:8px;font-size:12px;color:var(--ink-soft)}
.sched .settled{margin-top:10px;font-size:13px}
.sched .pending{margin-top:10px;border:2px solid var(--ink);border-radius:10px;padding:8px 12px;background:#fff8e6}
.sched .pending textarea{display:block;width:100%;margin-top:6px;font:inherit;font-size:12px}
.sched .msg{margin-top:8px;font-weight:700;min-height:1.5em}
.sched .tools{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sched .tools .ask{flex-basis:100%;border:2px dashed var(--ink);border-radius:8px;padding:6px 10px}
.sched button,.sched select,.sched input{font:inherit;font-size:13px}
.sched button{border:2px solid var(--ink);border-radius:8px;background:#fff;color:var(--ink);padding:1px 8px;cursor:pointer}
.sched button:focus-visible,.sched select:focus-visible,.sched input:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.day li.tk[draggable=true]{cursor:grab}
.day li.tk .more{margin-left:4px;font-size:12px;text-decoration:none}
.day li.menu{border-style:double;border-width:4px;background:#fff;display:grid;gap:6px}
.day li.menu .mrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.nowbox{margin-top:12px;border:2px solid var(--ink);border-radius:10px;padding:6px 12px;background:#fff8e6}
.cap{margin:4px 0}
.cap .bar{position:relative;height:10px;border:2px solid var(--ink);border-radius:5px;background:#fff;display:flex;overflow:visible}
.cap .bar i{display:block;height:100%}
.cap .bar .f{background:repeating-linear-gradient(45deg,#8a8678 0 3px,#fff 3px 6px)}
.cap .bar .p{background:var(--ink)}
.cap .bar .line{position:absolute;top:-5px;bottom:-5px;width:0;border-left:3px dotted var(--ink)}
.cap p{font-size:11px;color:var(--ink-soft);line-height:1.35;margin-top:3px}
.deadlines,.history,.inbox{margin-top:14px}
.deadlines ul,.history ul,.inbox ul{list-style:none;padding:0;margin-top:4px;font-size:13px}
.history li{display:grid;grid-template-columns:70px 120px 1fr;gap:8px;align-items:center}
.history .hb{position:relative;height:12px;border:2px solid var(--ink);border-radius:4px;display:block}
.history .hb i{position:absolute;left:0;top:0;height:100%}
.history .hb .a{background:#fff;border-right:2px solid var(--ink)}
.history .hb .b{background:var(--ink);height:50%;top:25%}
.inbox form{margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
@media print{
body{background:#fff}
.hud,.notice,.map-scroll,.log,.pane:not(.sched),.sched .pending,.sched .tools,.sched .msg,.sched .more,.sched .inbox form,.sched .legend~.sub{display:none!important}
.stage{display:block;padding:0}
.panel{box-shadow:none;border:0;padding:0}
.pane.sched[hidden]{display:block}
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;overflow:visible}
.day,.day li{border-color:#000;background:#fff!important;color:#000;break-inside:avoid}
.day li{font-size:10px}
.cap .bar .f{background:repeating-linear-gradient(45deg,#000 0 2px,#fff 2px 5px)}
}
@media (max-width:599px){.week{display:block}.day{margin-bottom:8px}}
`;

/** 今天的時段（終端機文字清單）：固定行程＋排的小行動，依時間排序；沒有任何內容回空陣列。 */
export function todayLines(model: Model, today: Date): string[] {
  const s = model.schedule;
  if (!s) return [];
  const day = weekdayIndex(today);
  const col = weekDayOf(s, today);
  const fixed = segmentsOn(s.fixed, day).map((g) => ({
    at: g.start,
    text: `  ▪ ${formatTime(g.start)}–${g.end >= DAY_MINUTES ? "24:00" : formatTime(g.end)} ${g.name}`,
  }));
  const tasks = (col === -1 ? [] : (s.week[col] ?? [])).map((t) => ({
    at: t.time ?? DAY_MINUTES,
    text: `  ${STATUS_SYMBOL[t.status]} ${t.time === undefined ? "" : `${formatTime(t.time)} `}${t.text}（${STATUS_WORD[t.status]}）`,
  }));
  const rows = [...fixed, ...tasks].sort((a, b) => a.at - b.at);
  if (rows.length === 0) return [];
  return [`◷ 今天 ${DAY_NAMES[day]}`, ...rows.map((r) => r.text)];
}

/** 鐘樓晶片的資料：本週排幾塊；沒有時間資料就回 undefined。 */
export function clockChipText(model: Model): string | undefined {
  if (!model.schedule) return undefined;
  const { planned } = weekCounts(model.schedule);
  return planned > 0 ? `排 ${planned} 塊` : "固定行程";
}

/** 週一對應的日期標籤（起始日不是週一就不顯示日期）。 */
function dateLabel(s: Schedule, day: number): string {
  if (s.weekStart === undefined) return "";
  const [y, m, d] = s.weekStart.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const start = new Date(y, m - 1, d);
  if (weekdayIndex(start) !== 0) return "";
  const at = new Date(y, m - 1, d + day);
  const two = (n: number) => String(n).padStart(2, "0");
  return ` ${two(at.getMonth() + 1)}/${two(at.getDate())}`;
}

function targetOf(model: Model, file: string | undefined): string | undefined {
  if (file === undefined) return undefined;
  return model.districts.find(
    (d) => d.id === file || d.file.replace(/\.md$/, "") === file,
  )?.id;
}

/** 週一起算的七個 MM/DD；起始日不是週一就全空。 */
function datesOf(s: Schedule): string[] {
  const blank = DAY_NAMES.map(() => "");
  if (s.weekStart === undefined) return blank;
  const [y, m, d] = s.weekStart.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  if (weekdayIndex(new Date(y, m - 1, d)) !== 0) return blank;
  const two = (n: number) => String(n).padStart(2, "0");
  return DAY_NAMES.map((_, i) => {
    const at = new Date(y, m - 1, d + i);
    return `${two(at.getMonth() + 1)}/${two(at.getDate())}`;
  });
}

const SETTLE_LINE =
  /排\s*(\d+)\s*塊[、,，]\s*做\s*(\d+)\s*塊(?:[、,，]\s*延後\s*(\d+)\s*塊)?/;
const KEEP_HALF_BELOW = 0.8;

/**
 * 這週只排可用時間的五成嗎？第一週（沒有歷史也沒有結算）是；
 * 之後看上週完成率：做了 ÷ (排了＋延到本週以外的) < 80% 繼續五成，≥ 80% 才六成。
 * 「排了」只是顯示用的數字（做了＋還沒）；延後走掉的塊也算沒做完，否則延後會讓完成率虛高。
 * 上週一塊都沒排、或結算讀不懂，算不出完成率，保守維持五成。
 * 與 skills/oasis-time/SKILL.md「每次的步驟」第 2 步同一條件。
 */
export function useHalfCap(s: Schedule): boolean {
  const last = s.history.at(-1);
  let planned = last?.planned;
  let done = last?.done;
  let postponed = last?.postponed ?? 0;
  if (last === undefined) {
    const m = SETTLE_LINE.exec(s.settled.at(-1) ?? "");
    if (m === null) return true;
    planned = Number(m[1]);
    done = Number(m[2]);
    postponed = Number(m[3] ?? 0);
  }
  if (planned === undefined || done === undefined) return true;
  const total = planned + postponed;
  return total === 0 ? true : done / total < KEEP_HALF_BELOW;
}

/** 給 lib 和瀏覽器用的行程資料（深拷貝，瀏覽器改它不會動到 model）。 */
export function scheduleData(model: Model, today: Date): SData {
  const s = model.schedule as Schedule;
  const col = weekDayOf(s, today);
  return {
    fixed: s.fixed,
    week: s.week.map((day) =>
      day.map((t) => ({ ...t, target: targetOf(model, t.file) })),
    ),
    dates: datesOf(s),
    weekStart: s.weekStart,
    today: col === -1 ? -1 : weekdayIndex(today),
    inbox: s.inbox,
    deadlines: s.deadlines,
    history: s.history,
    capacity: s.capacity,
    halfCap: useHalfCap(s),
  };
}

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 瀏覽器腳本：把 lib 與互動程式的原始碼接起來，載入時直接執行。 */
export const SCHEDULE_SCRIPT = `(${scheduleClient.toString()})((${scheduleLib.toString()})());`;

/** 行程表面板（data-for="clock"）；沒有時間資料回空字串。 */
export function schedulePane(model: Model, today: Date): string {
  const s = model.schedule;
  if (!s) return "";
  const lib = scheduleLib();
  const data = scheduleData(model, today);
  const { planned, done } = weekCounts(s);
  const note =
    data.today === -1
      ? `<p class="sub">這張表是 ${esc(s.weekStart ?? "")} 起的一週，今天不在其中；請對 Claude 說「排這週」更新。</p>`
      : "";
  const settledLines =
    s.capacity === undefined
      ? s.settled
      : [`容量：每週 ${s.capacity} 塊`, ...s.settled];
  const settled =
    settledLines.length > 0
      ? `<ul class="members settled">${settledLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
      : "";
  const nowMin = today.getHours() * 60 + today.getMinutes();
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<div class="pane sched" data-for="clock" hidden><h2>行程表<span class="lv">本週排 ${planned} 塊、做了 ${done} 塊</span></h2>${note}<div class="pending" hidden></div><p class="msg" role="status" aria-live="polite"></p><div class="tools"></div><p class="legend">圖例：▪ 固定行程　◇ 空檔　✓ 做了　○ 還沒　→ 延後　✕ 刪掉</p><div class="sbody">${lib.bodyHtml(data, nowMin, localIso(today))}</div>${settled}<script type="application/json" id="sched-data">${json}</script></div>`;
}
