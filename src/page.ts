import { darkenForAA, escapeXml as esc } from "./geom.ts";
import { daysSince } from "./model.ts";
import { CORE_COLOR } from "./layout.ts";
import { isEmptyCity } from "./profile.ts";
import {
  SCHEDULE_SCRIPT,
  SCHEDULE_STYLE,
  clockChipText,
  schedulePane,
} from "./schedule-view.ts";
import { renderSvg } from "./svg.ts";
import { CORE, type District, type Goal, type Model } from "./types.ts";
import { type View, buildView, goalText } from "./view.ts";

const STYLE = `
:root{--sky-top:#bfdcd6;--sky-low:#f1e2bd;--water:#1f6f78;--palm:#2f6b4f;--sun:#e3a12f;--ink:#17262b;--ink-soft:#55666a;--panel:#fbf7ec}
*{box-sizing:border-box;margin:0}
body{background:linear-gradient(var(--sky-top),var(--sky-low) 70%) fixed;min-height:100vh;color:var(--ink);font-family:"Noto Sans CJK TC",sans-serif;font-size:14px;line-height:1.5}
.hud{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:14px 22px}
.hud h1{font-size:22px;font-weight:700;margin-right:8px;letter-spacing:.06em}
.chip{display:flex;align-items:center;gap:8px;background:rgba(251,247,236,.85);border:2px solid var(--ink);border-radius:10px;padding:4px 12px 4px 6px;font-weight:700;box-shadow:0 3px 0 var(--ink)}
.chip .ic{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;color:#fff;font-size:13px}
button.chip{font:inherit;color:inherit;cursor:pointer}
.chip .ic.dark{color:#17262b}
.chip small{font-weight:400;color:var(--ink-soft)}
.hud .day{margin-left:auto;font-weight:700}
.notice{margin:0 22px 10px;padding:8px 14px;border:2px dashed #b4442f;border-radius:10px;background:#fff1ec;color:#7d2a1b;font-size:13px}
.notice b{display:block}
.notice li{margin-left:18px}
.stage{display:grid;grid-template-columns:1fr 330px;gap:18px;padding:0 22px 22px}
svg.city{width:100%;height:auto;display:block;min-width:calc(var(--vb-w) * 0.86px)}
.map-scroll{min-width:0;overflow-x:auto}
.b,.lbl{cursor:pointer}
.b.sel .ring{display:inline}
.b:focus{outline:none}
.b:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.b:focus-visible .ring{display:inline;stroke:var(--ink);stroke-width:4}
button.chip:focus-visible,.log button:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
aside{align-self:start}
.panel{background:var(--panel);border:2px solid var(--ink);border-radius:14px;box-shadow:0 5px 0 var(--ink);padding:16px}
.panel h2{font-size:19px}
.lv{display:inline-block;background:var(--ink);color:#fff;border-radius:6px;padding:0 7px;font-size:12px;margin-left:6px;vertical-align:3px}
.sub{color:var(--ink-soft);font-size:13px}
.xp{margin:12px 0 4px;height:12px;border:2px solid var(--ink);border-radius:7px;background:#fff;overflow:hidden}
.xp span{display:block;height:100%;background:linear-gradient(90deg,#f0c25a,var(--sun))}
.xp-label{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft)}
.quest{margin-top:14px;border:2px dashed var(--sun);border-radius:10px;padding:10px 12px;background:#fff8e6}
.quest b{display:block}
.goal-link{margin-top:12px;display:flex;align-items:center;gap:8px;font-size:13px}
.goal-link i{flex:none;width:26px;height:6px;border-radius:3px}
.members{margin-top:12px;font-size:13px;list-style:none;padding:0}
.log ul{padding:0}
.members li{padding:3px 0;border-top:1px solid #e6dcc4}
.strengths{margin-top:14px}.strengths h3{font-size:14px}
.log{margin-top:18px}
.log h3{font-size:14px;margin-bottom:6px}
.log li{list-style:none;border-top:1px solid #e6dcc4}
.log button{display:grid;grid-template-columns:18px 1fr auto;gap:8px;width:100%;padding:6px 0;border:0;background:none;font:inherit;font-size:13px;color:inherit;text-align:left;cursor:pointer}
.log li em{font-style:normal;color:var(--ink-soft)}
.mark{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;color:#17262b;background:var(--sun)}
@media (prefers-reduced-motion:reduce){.cars{display:none}}
@media (max-width:820px){.stage{grid-template-columns:1fr;padding:0 12px 18px}.hud{padding:12px}.notice{margin:0 12px 10px}}
${SCHEDULE_STYLE}`;

/** 頁面腳本（匯出給測試在假 DOM 裡跑）。 */
export const SCRIPT = `
(function(){
var first=document.querySelector(".pane:not([hidden])");
function pick(id){
document.querySelectorAll(".pane").forEach(function(p){p.hidden=p.dataset.for!==id});
document.querySelectorAll("svg .b").forEach(function(g){var on=g.dataset.id===id;g.classList.toggle("sel",on);g.setAttribute("aria-pressed",on?"true":"false")});
}
document.addEventListener("click",function(e){
var t=e.target.closest("[data-id]");
if(t)pick(t.dataset.id);
});
document.addEventListener("keydown",function(e){
if(e.key!=="Enter"&&e.key!==" "&&e.key!=="Spacebar")return;
var t=e.target.closest&&e.target.closest("[data-id][role=button]");
if(!t||t.tagName==="BUTTON")return;
e.preventDefault();
pick(t.dataset.id);
});
if(first)pick(first.dataset.for);
var city=document.querySelector("svg.city");
var still=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)");
function motion(){if(city&&city.pauseAnimations){if(still&&still.matches)city.pauseAnimations();else city.unpauseAnimations();}}
motion();
if(still&&still.addEventListener)still.addEventListener("change",motion);
var m=document.querySelector(".map-scroll");
if(m){
m.scrollLeft=(m.scrollWidth-m.clientWidth)/2;
var narrow=window.matchMedia&&window.matchMedia("(max-width:820px)");
var f=m.dataset.focus&&m.querySelector('[data-id="'+m.dataset.focus+'"]');
if(narrow&&narrow.matches&&f){
var fr=f.getBoundingClientRect(),mr=m.getBoundingClientRect();
m.scrollLeft+=fr.left+fr.width/2-(mr.left+mr.width/2);
}
}
})();
`;

interface ChipOpts {
  /** 有 id 的 chip 是 `<button>`，按下切換右側面板 */
  id?: string;
  /** 淺色底的圖示改用深色字 */
  dark?: boolean;
}

function chip(
  color: string,
  icon: string,
  text: string,
  small = "",
  opts: ChipOpts = {},
): string {
  const note = small === "" ? "" : `<small>${small}</small>`;
  const ic = `<span class="ic${opts.dark ? " dark" : ""}" style="background:${color}" aria-hidden="true">${icon}</span>`;
  const inner = `${ic}${text}${note}`;
  return opts.id === undefined
    ? `<div class="chip">${inner}</div>`
    : `<button type="button" class="chip" data-id="${esc(opts.id)}">${inner}</button>`;
}

function guardChip(model: Model): string[] {
  if (!model.guard) return [];
  const { total } = model.guard;
  return [chip("#b4442f", "▣", `守衛 ${total}`, "次警報", { id: "guard" })];
}

function libraryChip(model: Model): string[] {
  if (!model.learned && !model.skills) return [];
  const learned = model.learned?.length ?? 0;
  const skills = model.skills?.length ?? 0;
  return [
    chip("#6b4f8a", "✎", `學到 ${learned}`, `條・技能 ${skills} 個`, {
      id: "library",
    }),
  ];
}

function clockChip(model: Model): string[] {
  const text = clockChipText(model);
  return text === undefined
    ? []
    : [chip("#2f6b8f", "◷", "行程表", text, { id: "clock" })];
}

function hudHtml(model: Model, view: View): string {
  const { hud } = view;
  const goalColor =
    model.goals.find((g) => g.kind === "goal")?.color ?? "#d98c2b";
  return `<div class="hud"><h1>綠洲</h1>${[
    chip(darkenForAA(goalColor), "★", `目標 ${hud.goals}`, "進行中"),
    chip("var(--sun)", "!", `任務 ${hud.tasks}`, "等你接", { dark: true }),
    chip("var(--palm)", "▲", `在建 ${hud.building}`),
    chip("var(--water)", "≈", `自動 ${hud.auto}`, "正常"),
    ...guardChip(model),
    ...libraryChip(model),
    ...clockChip(model),
  ].join("")}<span class="day">${esc(view.dateLabel)}</span></div>`;
}

function noticeHtml(model: Model): string {
  const orphans = model.orphans.map(
    (o) =>
      `<li>${esc(o.name)}（${esc(o.file)}）：${esc(o.reason)}，沒有道路可通</li>`,
  );
  const errors = model.errors.map(
    (e) => `<li>${esc(e.file)}：${esc(e.reason)}</li>`,
  );
  const warnings = model.warnings.map(
    (w) => `<li>${esc(w.file)}：${esc(w.reason)}</li>`,
  );
  if (orphans.length + errors.length + warnings.length === 0) return "";
  const head = [
    orphans.length > 0
      ? `<b>${orphans.length} 個街區是孤兒，請補上 goal</b><ul>${orphans.join("")}</ul>`
      : "",
    errors.length > 0
      ? `<b>${errors.length} 張卡片讀不進來</b><ul>${errors.join("")}</ul>`
      : "",
    warnings.length > 0
      ? `<b>${warnings.length} 則提醒</b><ul>${warnings.join("")}</ul>`
      : "",
  ];
  return `<section class="notice">${head.join("")}</section>`;
}

function goalColorOf(d: District, model: Model): string | undefined {
  if (d.goal === CORE) return CORE_COLOR;
  return model.goals.find((g) => g.id === d.goal)?.color;
}

function barHtml(d: District): string {
  const xp = d.xp ?? undefined;
  const ratio = xp ? xp.current / xp.target : d.progress;
  if (ratio === undefined) return "";
  const pct = Math.round(Math.min(1, ratio) * 100);
  const left = xp ? xp.label : "進度";
  const right = xp ? `${xp.current} / ${xp.target}` : `${pct}%`;
  return `<div class="xp"><span style="width:${pct}%"></span></div><div class="xp-label"><span>${esc(left)}</span><span>${esc(right)}</span></div>`;
}

function questHtml(d: District, today: Date): string {
  if (d.state !== "waiting") {
    const note = d.statusText ?? d.due;
    return note
      ? `<p class="sub" style="margin-top:12px">${esc(note.replace(/\n/g, " "))}</p>`
      : "";
  }
  const days = daysSince(d.since, today);
  const wait = days === 0 ? "今天新增" : `已經等了 ${days} 天`;
  return `<div class="quest"><b>任務：${esc(d.quest ?? d.next)}</b><span class="sub">${esc(d.quest ? `${d.next}。${wait}。` : `${wait}。`)}</span></div>`;
}

function linkHtml(d: District, model: Model): string {
  const color = goalColorOf(d, model);
  if (!color) {
    return `<div class="goal-link">還沒接到任何目標（${esc(goalText(d, model))}）</div>`;
  }
  const text =
    d.goal === CORE
      ? "這條路接上綠洲核心（自動運轉的水源）"
      : `這條路通往「${esc(model.goals.find((g) => g.id === d.goal)?.name ?? "")}」`;
  return `<div class="goal-link"><i style="background:${color}"></i>${text}</div>`;
}

function strengthsHtml(d: District, model: Model): string {
  const list = model.strengths ?? [];
  if (d.building !== "core" || list.length === 0) return "";
  const items = list
    .map(
      (s) =>
        `<li>${esc(s.name)}<em class="sub">（${s.sources.length} 件事）</em></li>`,
    )
    .join("");
  return `<div class="strengths"><h3>我的強項</h3><ul class="members">${items}</ul></div>`;
}

function districtPane(
  d: District,
  model: Model,
  today: Date,
  hidden: boolean,
): string {
  const lv =
    d.state === "building" || d.state === "waiting"
      ? `<span class="lv">Lv.${d.level}</span>`
      : "";
  return `<div class="pane" data-for="${esc(d.id)}"${hidden ? " hidden" : ""}><h2>${esc(d.name)}${lv}</h2><p class="sub">${esc(d.next)}</p>${barHtml(d)}${questHtml(d, today)}${linkHtml(d, model)}${strengthsHtml(d, model)}</div>`;
}

function goalPane(g: Goal, model: Model): string {
  const members = model.districts.filter((d) => d.goal === g.id);
  const list = members.map((d) => `<li>${esc(d.name)}</li>`).join("");
  const kind = g.kind === "endgame" ? "終點" : "目標";
  return `<div class="pane" data-for="goal-${esc(g.id)}" hidden><h2>${esc(g.name)}<span class="lv">${kind}</span></h2><div class="goal-link"><i style="background:${g.color}"></i>通往這裡的街區 ${members.length} 個</div><ul class="members">${list}</ul></div>`;
}

function guardPane(model: Model): string {
  const guard = model.guard;
  if (!guard) return "";
  const rows = guard.recent
    .map(
      (e) =>
        `<li>${esc(e.summary)}<br><em class="sub">${esc(e.when)}（${esc(e.rule)}）</em></li>`,
    )
    .join("");
  const list =
    guard.total === 0
      ? '<p class="sub">城牆很安靜，還沒有攔下任何事。</p>'
      : `<ul class="members">${rows}</ul>`;
  return `<div class="pane" data-for="guard" hidden><h2>城牆守衛<span class="lv">共 ${guard.total} 次</span></h2><p class="sub">守衛攔下或先問過你的動作。最近 ${guard.recent.length} 筆：</p>${list}</div>`;
}

function libraryPane(model: Model): string {
  if (!model.learned && !model.skills) return "";
  const rules = (model.learned ?? [])
    .map(
      (r) =>
        `<li>${esc(r.rule)}<br><em class="sub">${esc(r.use)}${r.date ? `（${esc(r.date)}）` : ""}</em></li>`,
    )
    .join("");
  const skills = (model.skills ?? [])
    .map(
      (s) => `<li>${esc(s.name)}<br><em class="sub">${esc(s.when)}</em></li>`,
    )
    .join("");
  const rulesBlock = rules
    ? `<p class="sub">學到的事：</p><ul class="members">${rules}</ul>`
    : '<p class="sub">還沒有學到的事，收工時 Claude 會問你要不要記下來。</p>';
  const skillsBlock = skills
    ? `<p class="sub">技能：</p><ul class="members">${skills}</ul>`
    : "";
  return `<div class="pane" data-for="library" hidden><h2>圖書館<span class="lv">學到 ${model.learned?.length ?? 0} 條</span></h2>${rulesBlock}${skillsBlock}</div>`;
}

function boardHtml(model: Model): string {
  const items = model.districts
    .filter((d) => d.state === "waiting")
    .map(
      (d) =>
        `<li><button type="button" data-id="${esc(d.id)}"><span class="mark" aria-hidden="true">!</span>${esc(d.quest ?? d.next)}<em>${esc(d.short ?? d.name)}</em></button></li>`,
    );
  if (items.length === 0) return "";
  return `<div class="log"><h3>任務板</h3><ul>${items.join("")}</ul></div>`;
}

/** 預設選中：第一個等你的街區，其次第一個在建，再來第一個。 */
function defaultId(model: Model): string | undefined {
  const pick = (s: string) => model.districts.find((d) => d.state === s);
  return (pick("waiting") ?? pick("building") ?? model.districts[0])?.id;
}

/** 手機寬度首次載入要捲到的地標：預設街區通往的目標，沒有就第一個目標。 */
export function focusGoalId(model: Model): string | undefined {
  const goalOf = model.districts.find((d) => d.id === defaultId(model))?.goal;
  const goal =
    model.goals.find((g) => g.id === goalOf) ??
    model.goals.find((g) => g.kind === "goal");
  return goal ? `goal-${goal.id}` : undefined;
}

function cityHtml(model: Model): string {
  try {
    const svg = renderSvg(model, undefined, { animate: true }).replace(
      "<svg ",
      '<svg class="city" ',
    );
    const focus = focusGoalId(model);
    const attr = focus ? ` data-focus="${esc(focus)}"` : "";
    return `<div class="map-scroll"${attr}>${svg}</div>`;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return `<p class="notice">地圖畫不出來：${esc(why)}</p>`;
  }
}

/** 完整獨立頁面：HUD、等角地圖、右側面板（點建築切換）。 */
export function renderPage(model: Model, today: Date): string {
  const view = buildView(model, today);
  const first = defaultId(model);
  const panes = [
    ...model.districts.map((d) =>
      districtPane(d, model, today, d.id !== first),
    ),
    ...model.goals.map((g) => goalPane(g, model)),
    guardPane(model),
    libraryPane(model),
    schedulePane(model, today),
  ].join("");
  const empty =
    model.districts.length === 0
      ? `<h2>${isEmptyCity(model) ? "還是一座空城" : "還沒有街區"}</h2><p class="sub">${esc(view.lede)}</p>`
      : "";
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>綠洲地圖</title><style>${STYLE}</style></head>
<body>${hudHtml(model, view)}
${noticeHtml(model)}
<div class="stage">${cityHtml(model)}
<aside aria-label="說明面板"><div class="panel" aria-live="polite">${panes}${empty}${boardHtml(model)}</div></aside></div>
<script>${SCRIPT}</script>${model.schedule ? `<script>${SCHEDULE_SCRIPT}</script>` : ""}
</body></html>
`;
}
