import type { FixedBlock, PlanTask } from "./schedule.ts";

/**
 * 行程表的純函式庫：伺服器端（build-map、viewer）和瀏覽器共用同一份。
 * 瀏覽器那邊是把這個函式 `toString()` 後塞進頁面再呼叫，所以它必須自給自足：
 * 不能引用任何外面的 import 或常數，型別（編譯時就消失）除外。
 */

/** 頁面上的一塊小行動（PlanTask 加上介面用的欄位）。 */
export type LibTask = PlanTask & {
  /** 點了跳到哪個建築（街區 id） */
  target?: string;
  /** 已被移到別天，這裡不再顯示 */
  gone?: boolean;
  /** 延後去哪天等補充 */
  note?: string;
};

export interface Deadline {
  /** YYYY-MM-DD */
  date: string;
  text: string;
}
export interface InboxItem {
  text: string;
  /** MM/DD */
  due?: string;
}
export interface HistoryItem {
  /** 例如 11/02 起 */
  label: string;
  planned: number;
  done: number;
}

/** 寫進頁面、給瀏覽器用的行程資料。 */
export interface SData {
  fixed: FixedBlock[];
  week: LibTask[][];
  /** 七個 MM/DD；起始日不是週一就是空字串 */
  dates: string[];
  /** 本週起始日 YYYY-MM-DD（沒寫就是 undefined） */
  weekStart?: string;
  /** 今天在本週表的哪一欄；不在這週是 -1 */
  today: number;
  inbox: InboxItem[];
  deadlines: Deadline[];
  history: HistoryItem[];
  /** `## 實際能做` 的 `- 容量：每週 N 塊`；沒寫就是 undefined */
  capacity?: number;
  /** 第一週、或上週完成不到八成：每天只排可用時間的一半 */
  halfCap?: boolean;
}

export type ChangeKind =
  | "done"
  | "postpone"
  | "move"
  | "drop"
  | "small"
  | "add";

/** 一筆改動（可轉成 `[綠洲時間改動]` 一行文字，也可從文字讀回來）。 */
export interface Change {
  kind: ChangeKind;
  day: number;
  /** 那一天第幾塊（只有在頁面上操作時才有；從文字讀回來的用 text 找） */
  idx?: number;
  text: string;
  toDay?: number;
  toTime?: number;
  /** 延後到本週以外的日子（MM/DD）：這件事改放進待排 */
  later?: string;
  reason?: string;
  due?: string;
}

export interface Verdict {
  ok: boolean;
  reason?: string;
}

export function scheduleLib() {
  const DAY = 1440;
  const DEFAULT_MIN = 30;
  const CAP = 0.6;
  const FIRST_CAP = 0.5;
  // 緩衝規則（與 oasis-time SKILL.md「每次的步驟」第 1 步同一套）：
  // 固定行程前後各 15 分；睡覺前 60 分、起床後 30 分；不到 30 分的空檔不算；
  // 睡覺若在凌晨才開始（06:00 前），午夜到睡覺之間是熬夜時段，整段不算可用。
  const BUFFER = 15;
  const SLEEP_LEAD = 60;
  const SLEEP_TAIL = 30;
  const MIN_GAP = 30;
  const LONG_BLOCK = 240;
  const MERGE_GAP = 60;
  const LATE_BEFORE = 360;
  const NAMES = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
  const REASONS = ["被吃掉", "太大塊", "狀況變了", "不想做"];
  const HEAD = "[綠洲時間改動]";

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const rng = (a: number, b: number) =>
    `${fmt(a)}–${b >= DAY ? "24:00" : fmt(b)}`;
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const hm = (m: number) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h === 0) return `${r} 分`;
    return r === 0 ? `${h} 小時` : `${h} 小時 ${r} 分`;
  };
  const mins = (t: LibTask) => t.minutes ?? DEFAULT_MIN;
  const occupies = (t: LibTask) =>
    !t.gone && (t.status === "done" || t.status === "todo");

  function segmentsOn(fixed: FixedBlock[], day: number) {
    const out: { start: number; end: number; name: string }[] = [];
    for (const b of fixed) {
      const crosses = b.end <= b.start;
      if (b.days.includes(day)) {
        out.push({ start: b.start, end: crosses ? DAY : b.end, name: b.name });
      }
      if (crosses && b.days.includes((day + 6) % 7)) {
        out.push({ start: 0, end: b.end, name: b.name });
      }
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  /** 有時間的小行動占住的區段 */
  function taskSpans(d: SData, day: number) {
    return (d.week[day] ?? [])
      .filter((t) => occupies(t) && t.time !== undefined)
      .map((t) => ({
        start: t.time as number,
        end: Math.min(DAY, (t.time as number) + mins(t)),
        name: t.text,
      }));
  }

  /** 固定行程與有時間的小行動占住的區段 */
  function busy(d: SData, day: number) {
    return [...segmentsOn(d.fixed, day), ...taskSpans(d, day)];
  }

  /** 放置用的占用區段：固定行程加緩衝（與 unavailable 同一套）＋已排的塊，空檔列的起點因此是合法時刻。 */
  function placeable(d: SData, day: number) {
    return [...unavailable(d, day), ...taskSpans(d, day)];
  }

  function gapsOf(
    segs: { start: number; end: number }[],
    minLen: number,
  ): { start: number; end: number }[] {
    const gaps: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const s of [...segs].sort((a, b) => a.start - b.start)) {
      if (s.start - cursor >= minLen)
        gaps.push({ start: cursor, end: s.start });
      cursor = Math.max(cursor, s.end);
    }
    if (DAY - cursor >= minLen) gaps.push({ start: cursor, end: DAY });
    return gaps;
  }

  /** 不可用的區段：固定行程加上緩衝（睡前凌晨的熬夜時段也算）。 */
  function unavailable(d: SData, day: number) {
    return segmentsOn(d.fixed, day).map((s) => {
      const sleep = /睡/.test(s.name);
      const lateNight = sleep && s.start > 0 && s.start < LATE_BEFORE;
      const lead = sleep ? (lateNight ? s.start : SLEEP_LEAD) : BUFFER;
      const tail = sleep ? SLEEP_TAIL : BUFFER;
      return {
        start: s.start > 0 ? Math.max(0, s.start - lead) : 0,
        end: s.end < DAY ? Math.min(DAY, s.end + tail) : DAY,
        seg: s,
        sleep,
        before: s.start > 0 ? lead : 0,
        after: s.end < DAY ? tail : 0,
      };
    });
  }

  /** 一天的容量：固定行程、緩衝、已排、可用、六成上限（分鐘）。skip 是不算進去的那一塊。 */
  function capacity(d: SData, day: number, skip = -1) {
    const sum = (gs: { start: number; end: number }[]) =>
      gs.reduce((n, g) => n + g.end - g.start, 0);
    const fixed = DAY - sum(gapsOf(segmentsOn(d.fixed, day), 1));
    const avail = sum(gapsOf(unavailable(d, day), MIN_GAP));
    const buffer = DAY - fixed - avail;
    const planned = (d.week[day] ?? []).reduce(
      (n, t, i) => (i !== skip && occupies(t) ? n + mins(t) : n),
      0,
    );
    return {
      fixed,
      buffer,
      planned,
      avail,
      limit: Math.floor(avail * (d.halfCap ? FIRST_CAP : CAP)),
    };
  }

  /** 放置時間壓到固定行程前後的緩衝：用白話說是哪一段、為什麼。 */
  function bufferVerdict(
    day: number,
    time: number,
    u: ReturnType<typeof unavailable>[number],
  ): Verdict {
    const s = u.seg;
    const at = `${NAMES[day]} ${fmt(time)}`;
    if (u.sleep && time >= s.end) {
      return {
        ok: false,
        reason: `${at} 太接近起床時間（睡醒後 ${u.after} 分鐘先留給自己，${NAMES[day]} ${fmt(s.end + u.after)} 之後才排）`,
      };
    }
    if (u.sleep) {
      return {
        ok: false,
        reason: `${at} 太接近睡覺時間（睡前 ${u.before} 分鐘要留來休息，不排進去）`,
      };
    }
    return {
      ok: false,
      reason:
        time >= s.end
          ? `${at} 離「${s.name}」剛結束太近，先留 ${u.after} 分鐘緩衝，${fmt(s.end + u.after)} 之後才排`
          : `${at} 離「${s.name}」開始太近，前面要留 ${u.before} 分鐘緩衝`,
    };
  }

  /** 非睡眠的固定行程，間隔 ≤60 分（例如午餐）的合併成一段，用來判斷「連續 ≥240 分」。 */
  function mergedFixed(d: SData, day: number) {
    const out: { start: number; end: number; name: string }[] = [];
    for (const s of segmentsOn(d.fixed, day)) {
      if (/睡/.test(s.name)) continue;
      const last = out.at(-1);
      if (last && s.start - last.end <= MERGE_GAP) {
        last.end = Math.max(last.end, s.end);
        if (last.name !== s.name) last.name = `${last.name}～${s.name}`;
      } else out.push({ ...s });
    }
    return out;
  }

  /** 連續 ≥240 分的固定行程（打工、整段上課；中間隔 ≤60 分的午餐算連續）結束後到睡前，最多排 1 塊。 */
  function afterLongBlock(
    d: SData,
    day: number,
    time: number | undefined,
    skip: number,
  ): Verdict | undefined {
    if (time === undefined) return undefined;
    const long = mergedFixed(d, day).find(
      (s) => s.end - s.start >= LONG_BLOCK && time >= s.end,
    );
    if (!long) return undefined;
    const already = (d.week[day] ?? []).filter(
      (t, i) =>
        i !== skip && occupies(t) && t.time !== undefined && t.time >= long.end,
    ).length;
    if (already < 1) return undefined;
    return {
      ok: false,
      reason: `${NAMES[day]} 「${long.name}」連續 ${hm(long.end - long.start)}，結束後到睡前最多排 1 塊，這天已經有了`,
    };
  }

  /** 放得下嗎？不能壓到固定行程（含睡眠），不能讓那天超過可用時間的六成（第一週一半），整週也不能超過容量 N 塊。freed > 0 是移動（移到或延後，總數不會變多），不做整週容量檢查，超過容量的週也能改時間。 */
  function canPlace(
    d: SData,
    day: number,
    time: number | undefined,
    minutes: number,
    skip = -1,
    freed = 0,
  ): Verdict {
    if (time !== undefined) {
      const end = Math.min(DAY, time + minutes);
      const hit = segmentsOn(d.fixed, day).find(
        (s) => time < s.end && end > s.start,
      );
      if (hit) {
        const where = `${NAMES[day]} ${rng(hit.start, hit.end)}`;
        return {
          ok: false,
          reason: /睡/.test(hit.name)
            ? `${where} 是睡覺時段，不排進睡眠時間`
            : `${where} 是固定行程「${hit.name}」，不能排進去`,
        };
      }
    }
    const late = segmentsOn(d.fixed, day).find(
      (s) => /睡/.test(s.name) && s.start > 0 && s.start < LATE_BEFORE,
    );
    if (time !== undefined && late && time < late.start) {
      return {
        ok: false,
        reason: `${NAMES[day]} ${rng(0, late.start)} 在睡覺之前，不建議把事情排到半夜`,
      };
    }
    if (time !== undefined) {
      const end = Math.min(DAY, time + minutes);
      const near = unavailable(d, day).find(
        (u) => time < u.end && end > u.start,
      );
      if (near) return bufferVerdict(day, time, near);
    }
    const c = capacity(d, day, skip);
    if (c.planned + minutes > c.limit) {
      return {
        ok: false,
        reason: `${NAMES[day]} 已排 ${hm(c.planned)}，再排就超過可用時間的${d.halfCap ? "一半（這週先排一半）" : "六成"}（可用 ${hm(c.avail)}，上限 ${hm(c.limit)}）`,
      };
    }
    const crowded = afterLongBlock(d, day, time, skip);
    if (crowded) return crowded;
    const week = counts(d).planned;
    if (freed === 0 && d.capacity !== undefined && week + 1 > d.capacity) {
      return {
        ok: false,
        reason: `這週已排 ${week} 塊，再排就超過每週 ${d.capacity} 塊的容量`,
      };
    }
    return { ok: true };
  }

  const dayLabel = (d: SData, i: number) => d.dates[i] || NAMES[i] || "";

  /** 一行改動文字（`[綠洲時間改動] 11/09 讀第3章 → 延後到 11/11，原因：太大塊`） */
  function formatChange(d: SData, c: Change): string {
    const text = c.text.replace(/\s+/g, " ").replace(/ → /g, " - ").trim();
    if (c.kind === "add") {
      return `${HEAD} 新增待排 ${text}${c.due ? `，截止 ${c.due}` : ""}`;
    }
    const to = `${c.later ?? dayLabel(d, c.toDay ?? 0)}${c.toTime === undefined ? "" : ` ${fmt(c.toTime)}`}`;
    const why = c.reason ? `，原因：${c.reason}` : "";
    const action: Record<string, string> = {
      done: "做了",
      postpone: `延後到 ${to}${why}`,
      move: `移到 ${to}`,
      drop: `刪掉${why}`,
      small: "標記太大塊",
    };
    return `${HEAD} ${dayLabel(d, c.day)} ${text} → ${action[c.kind]}`;
  }

  /** 從貼回來的文字讀出改動；只收固定格式的行，其他一律忽略並回報。 */
  function parseChanges(d: SData, input: string) {
    const changes: Change[] = [];
    const ignored: string[] = [];
    const dayOf = (tok: string) => {
      const i = d.dates.indexOf(tok);
      return i >= 0 ? i : NAMES.indexOf(tok);
    };
    const timeOf = (s: string | undefined) => {
      if (s === undefined) return undefined;
      const [h, m] = s.split(":").map(Number) as [number, number];
      return h * 60 + m;
    };
    for (const raw of input.split("\n")) {
      const line = raw.trim();
      if (!line.startsWith(HEAD)) continue;
      const body = line.slice(HEAD.length).trim();
      const add = /^新增待排 (.+?)(?:，截止 (\d{1,2}\/\d{1,2}))?$/.exec(body);
      if (add) {
        changes.push({
          kind: "add",
          day: 0,
          text: add[1] as string,
          due: add[2],
        });
        continue;
      }
      const cut = body.lastIndexOf(" → ");
      const left = cut < 0 ? "" : body.slice(0, cut);
      const act = cut < 0 ? "" : body.slice(cut + 3);
      const space = left.indexOf(" ");
      const day = space < 0 ? -1 : dayOf(left.slice(0, space));
      const text = left.slice(space + 1).trim();
      const change = (c: Omit<Change, "day" | "text">): Change => ({
        ...c,
        day,
        text,
      });
      const reasonOk = (r: string | undefined) =>
        r === undefined || REASONS.includes(r);
      let parsed: Change | undefined;
      let m: RegExpExecArray | null;
      if (day < 0 || text === "") parsed = undefined;
      else if (act === "做了") parsed = change({ kind: "done" });
      else if (act === "標記太大塊") parsed = change({ kind: "small" });
      else if (
        (m = /^延後到 ([^\s，]+)(?: (\d{1,2}:\d{2}))?(?:，原因：(.+))?$/.exec(
          act,
        ))
      ) {
        const toDay = dayOf(m[1] as string);
        if (toDay >= 0 && reasonOk(m[3])) {
          parsed = change({
            kind: "postpone",
            toDay,
            toTime: timeOf(m[2]),
            reason: m[3],
          });
        } else if (
          toDay < 0 &&
          /^\d{1,2}\/\d{1,2}$/.test(m[1] as string) &&
          reasonOk(m[3])
        ) {
          parsed = change({
            kind: "postpone",
            later: m[1],
            reason: m[3],
          });
        }
      } else if ((m = /^移到 ([^\s，]+)(?: (\d{1,2}:\d{2}))?$/.exec(act))) {
        const toDay = dayOf(m[1] as string);
        if (toDay >= 0) {
          parsed = change({ kind: "move", toDay, toTime: timeOf(m[2]) });
        }
      } else if ((m = /^刪掉(?:，原因：(.+))?$/.exec(act))) {
        if (reasonOk(m[1])) parsed = change({ kind: "drop", reason: m[1] });
      }
      if (parsed) changes.push(parsed);
      else ignored.push(line.slice(0, 60));
    }
    return { changes, ignored };
  }

  /** 延到本週以外：放進待排的那行字，留著原日期 */
  const laterText = (d: SData, c: Change) =>
    `${c.text}（原定 ${dayLabel(d, c.day)}，延後到 ${c.later}）`;

  /** 把一筆改動套到資料上（會改 d）。放不進去就回 ok:false 並說原因，資料不動。 */
  function applyChange(d: SData, c: Change): Verdict {
    if (c.kind === "add") {
      d.inbox.push({ text: c.text, due: c.due });
      return { ok: true };
    }
    const list = d.week[c.day] ?? [];
    const idx =
      c.idx ??
      list.findIndex((t) => !t.gone && occupies(t) && t.text === c.text);
    const t = list[idx];
    if (!t) return { ok: false, reason: `找不到「${c.text}」` };
    if (c.kind === "done") t.status = "done";
    else if (c.kind === "small") t.big = true;
    else if (c.kind === "drop") {
      t.status = "dropped";
      t.note = c.reason;
    } else if (c.later !== undefined) {
      t.status = "moved";
      t.note = `→ ${c.later}`;
      d.inbox.push({ text: laterText(d, c) });
    } else {
      const toDay = c.toDay ?? c.day;
      const sameDay = toDay === c.day && c.kind === "move";
      const v = canPlace(
        d,
        toDay,
        c.toTime,
        mins(t),
        sameDay ? idx : -1,
        c.kind === "move" || c.kind === "postpone" ? 1 : 0,
      );
      if (!v.ok) return v;
      if (sameDay) {
        t.time = c.toTime;
        return { ok: true };
      }
      const copy: LibTask = { ...t, status: "todo", time: c.toTime };
      delete copy.note;
      delete copy.big;
      if (c.kind === "postpone") {
        t.status = "moved";
        t.note = `→ ${NAMES[toDay]}`;
      } else t.gone = true;
      d.week[toDay]?.push(copy);
    }
    return { ok: true };
  }

  /** 把改動套到 本週.md 原文：改狀態、搬到別天、補進「待排」。套不上的回報。 */
  function applyToMarkdown(md: string, d: SData, changes: Change[]) {
    const lines = md.split("\n");
    const skipped: string[] = [];
    const sectionOf = (day: number) =>
      lines.findIndex((l) => new RegExp(`^##\\s*${NAMES[day]}`).test(l));
    const endOf = (start: number) => {
      let i = start + 1;
      while (i < lines.length && !/^##/.test(lines[i] as string)) i++;
      while (i > start + 1 && (lines[i - 1] as string).trim() === "") i--;
      return i;
    };
    const lineOf = (day: number, text: string) => {
      const s = sectionOf(day);
      if (s < 0) return -1;
      for (let i = s + 1; i < endOf(s); i++) {
        if (
          (lines[i] as string).includes(text) &&
          /^[-*]\s*\[ \]|^[-*]\s*\[x\]/i.test((lines[i] as string).trim())
        )
          return i;
      }
      return -1;
    };
    const taskLine = (c: Change, status: string) => {
      const src = d.week[c.day]?.find((t) => t.text === c.text);
      const time = c.toTime === undefined ? "" : `${fmt(c.toTime)} `;
      const m = src?.minutes === undefined ? "" : `（${src.minutes} 分）`;
      const f = src?.file === undefined ? "" : ` @ ${src.file}`;
      return `- [${status}] ${time}${c.text}${m}${f}`;
    };
    const append = (day: number, line: string) => {
      const s = sectionOf(day);
      if (s < 0) return false;
      lines.splice(endOf(s), 0, line);
      return true;
    };
    const addInbox = (line: string) => {
      let s = lines.findIndex((l) => /^##\s*待排/.test(l));
      if (s < 0) {
        lines.push("## 待排");
        s = lines.length - 1;
      }
      lines.splice(endOf(s), 0, `- ${line}`);
    };
    for (const c of changes) {
      const label = formatChange(d, c);
      if (c.kind === "add") {
        addInbox(`${c.text}${c.due ? `（截止 ${c.due}）` : ""}`);
        continue;
      }
      const at = lineOf(c.day, c.text);
      if (at < 0) {
        skipped.push(label);
        continue;
      }
      if (c.kind === "small") {
        const cur = lines[at] as string;
        if (!/[（(]\s*太大塊\s*[）)]/.test(cur)) {
          lines[at] = cur.replace(/(\s*[@＠]\s*\S+)?\s*$/, "（太大塊）$1");
        }
      } else if (c.later !== undefined) {
        lines[at] = `- [>] 延後：${c.text} → ${c.later}`;
        addInbox(laterText(d, c));
      } else if (c.kind === "done")
        lines[at] = (lines[at] as string).replace(/\[ \]/, "[x]");
      else if (c.kind === "drop") lines[at] = `- [-] 刪掉：${c.text}`;
      else if (!append(c.toDay ?? c.day, taskLine(c, " "))) skipped.push(label);
      else if (c.kind === "postpone")
        lines[at] = `- [>] 延後：${c.text} → ${NAMES[c.toDay ?? c.day]}`;
      else lines.splice(at, 1);
    }
    return { text: lines.join("\n"), skipped };
  }

  // ---- 畫面 ----

  function taskHtml(t: LibTask, day: number, i: number) {
    const sym: Record<string, string> = {
      done: "✓",
      todo: "○",
      moved: "→",
      dropped: "✕",
    };
    const word: Record<string, string> = {
      done: "做了",
      todo: "還沒",
      moved: "延後",
      dropped: "刪掉",
    };
    const when = t.time === undefined ? "" : `${fmt(t.time)} `;
    const m = t.minutes === undefined ? "" : `（${t.minutes} 分）`;
    const text = esc(`${t.text}${m}`);
    const label = t.target
      ? `<button type="button" data-id="${esc(t.target)}">${text}</button>`
      : text;
    const extra = [t.big ? "太大塊" : "", t.note ?? ""].filter(Boolean);
    const note = extra.length
      ? ` <small>（${esc(extra.join("、"))}）</small>`
      : "";
    const open = t.status === "todo" || t.status === "done";
    const more = open
      ? ` <button type="button" class="more" data-act="menu" data-day="${day}" data-i="${i}" aria-label="操作：${esc(t.text)}">⋯ 操作</button>`
      : "";
    const drag = open
      ? ` draggable="true" data-day="${day}" data-i="${i}"`
      : "";
    return `<li class="tk ${t.status}"${drag}><b><span aria-hidden="true">${sym[t.status]}</span> ${word[t.status]}</b>${when}${label}${note}${more}</li>`;
  }

  function dayRows(d: SData, day: number) {
    const list = d.week[day] ?? [];
    const segs = segmentsOn(d.fixed, day);
    const rows: { at: number; html: string }[] = [
      ...segs.map((g) => ({
        at: g.start,
        html: `<li class="fx" data-day="${day}" data-at="${g.start}"><b><span aria-hidden="true">▪</span> 固定</b>${rng(g.start, g.end)} ${esc(g.name)}</li>`,
      })),
      ...gapsOf(placeable(d, day), 60).map((g) => ({
        at: g.start,
        html: `<li class="free" data-day="${day}" data-at="${g.start}"><b><span aria-hidden="true">◇</span> 空檔</b>${rng(g.start, g.end)}</li>`,
      })),
    ];
    const timed: { at: number; html: string }[] = [];
    const untimed: string[] = [];
    list.forEach((t, i) => {
      if (t.gone) return;
      if (t.time === undefined) untimed.push(taskHtml(t, day, i));
      else timed.push({ at: t.time, html: taskHtml(t, day, i) });
    });
    return [...rows, ...timed]
      .sort((a, b) => a.at - b.at)
      .map((r) => r.html)
      .concat(untimed);
  }

  /** 容量條：固定行程／已排／剩餘，標出六成線。狀態一律有文字，條只是輔助。 */
  function capHtml(d: SData, day: number) {
    const c = capacity(d, day);
    const pct = (n: number) => Math.min(100, Math.round((n / DAY) * 100));
    const line = pct(c.fixed + c.buffer + c.limit);
    const name = d.halfCap ? "五成線" : "六成線";
    const over = c.planned > c.limit ? `，已過${name}` : "";
    return `<div class="cap"><div class="bar" aria-hidden="true"><i class="f" style="width:${pct(c.fixed + c.buffer)}%"></i><i class="p" style="width:${pct(c.planned)}%"></i><i class="line" style="left:${line}%"></i></div><p>固定 ${hm(c.fixed)}・緩衝 ${hm(c.buffer)}・已排 ${hm(c.planned)}・剩 ${hm(Math.max(0, c.avail - c.planned))}<br>${name} ${hm(c.limit)}${over}</p></div>`;
  }

  function dayHtml(d: SData, day: number) {
    const items = dayRows(d, day);
    const list = items.length
      ? items.join("")
      : '<li class="free">（沒有排）</li>';
    const today = day === d.today;
    const date = d.dates[day] ? ` ${d.dates[day]}` : "";
    return `<section class="day${today ? " today" : ""}" data-day="${day}"><h3><span>${NAMES[day]}${date}</span>${today ? "<em>今天</em>" : ""}</h3>${capHtml(d, day)}<ul>${list}</ul></section>`;
  }

  function weekHtml(d: SData) {
    return NAMES.map((_, i) => dayHtml(d, i)).join("");
  }

  function counts(d: SData) {
    const all = d.week.flat().filter((t) => !t.gone);
    return {
      planned: all.filter((t) => occupies(t)).length,
      done: all.filter((t) => t.status === "done").length,
    };
  }

  /** 現在在做什麼、下一塊是什麼、今天還剩多少空檔。 */
  function nowInfo(d: SData, nowMin: number) {
    if (d.today < 0) return undefined;
    const list = (d.week[d.today] ?? []).filter((t) => !t.gone);
    const span = (t: LibTask) => ({
      start: t.time as number,
      end: (t.time as number) + mins(t),
    });
    const doing = list.find(
      (t) =>
        t.status === "todo" &&
        t.time !== undefined &&
        span(t).start <= nowMin &&
        nowMin < span(t).end,
    );
    const seg = segmentsOn(d.fixed, d.today).find(
      (s) => s.start <= nowMin && nowMin < s.end,
    );
    const next =
      list
        .filter(
          (t) =>
            t.status === "todo" &&
            t.time !== undefined &&
            (t.time as number) > nowMin,
        )
        .sort((a, b) => (a.time as number) - (b.time as number))[0] ??
      list.find((t) => t.status === "todo" && t.time === undefined);
    const left = gapsOf(
      [...busy(d, d.today), { start: 0, end: nowMin }],
      30,
    ).reduce((n, g) => n + g.end - g.start, 0);
    const nowText = doing
      ? `${fmt(span(doing).start)}–${fmt(Math.min(DAY, span(doing).end))} ${doing.text}`
      : seg
        ? `${rng(seg.start, seg.end)} ${seg.name}（固定行程）`
        : "空檔，現在沒有安排";
    const nextText = next
      ? `${next.time === undefined ? "（沒定時間）" : fmt(next.time)} ${next.text}`
      : "今天沒有了";
    return { nowText, nextText, left, clock: fmt(nowMin) };
  }

  function nowHtml(d: SData, nowMin: number) {
    const n = nowInfo(d, nowMin);
    if (!n) return "";
    return `<div class="nowbox"><p><b>◷ 現在 ${n.clock}</b>　${esc(n.nowText)}</p><p><b>▸ 下一塊</b>　${esc(n.nextText)}</p><p><b>◇ 空檔</b>　今天接下來還有 ${hm(n.left)}</p></div>`;
  }

  const utc = (iso: string) => {
    const [y, m, dd] = iso.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, dd);
  };

  /** 近期截止日倒數：只描述還有幾天，不催。 */
  function deadlinesHtml(d: SData, todayIso: string) {
    const rows = d.deadlines
      .map((x) => ({
        ...x,
        n: Math.round((utc(x.date) - utc(todayIso)) / 86_400_000),
      }))
      .filter((x) => x.n >= -3 && x.n <= 30)
      .sort((a, b) => a.n - b.n)
      .map((x) => {
        const when =
          x.n === 0
            ? "就是今天"
            : x.n > 0
              ? `還有 ${x.n} 天`
              : `已過 ${-x.n} 天`;
        return `<li>▸ ${x.date.slice(5).replace("-", "/")} ${esc(x.text)}：${when}</li>`;
      });
    if (!rows.length) return "";
    return `<div class="deadlines"><h3>近期截止日</h3><ul>${rows.join("")}</ul></div>`;
  }

  /** 最近幾週排了幾塊、做了幾塊：只描述，沒有好壞。 */
  function historyHtml(d: SData) {
    const now = counts(d);
    const items = [
      ...d.history,
      { label: "這週", planned: now.planned, done: now.done },
    ];
    if (items.length < 2) return "";
    const max = Math.max(1, ...items.map((h) => h.planned));
    const rows = items
      .map((h) => {
        const w = (n: number) => Math.round((n / max) * 100);
        return `<li><span class="hl">${esc(h.label)}</span><span class="hb" aria-hidden="true"><i class="a" style="width:${w(h.planned)}%"></i><i class="b" style="width:${w(h.done)}%"></i></span><span>排 ${h.planned} 塊、做 ${h.done} 塊</span></li>`;
      })
      .join("");
    return `<div class="history"><h3>最近幾週</h3><p class="sub">空心條是排的塊數，實心條是做的塊數；只是記錄。</p><ul>${rows}</ul></div>`;
  }

  function inboxHtml(d: SData) {
    const rows = d.inbox
      .map(
        (x) =>
          `<li>◇ ${esc(x.text)}${x.due ? `（截止 ${esc(x.due)}）` : ""}</li>`,
      )
      .join("");
    const list = rows
      ? `<ul>${rows}</ul>`
      : '<p class="sub">還沒有待排的事。</p>';
    return `<div class="inbox"><h3>待排</h3>${list}<form class="addform"><label>新增一件事 <input name="text" type="text" size="18"></label> <label>截止日（選填） <input name="due" type="date"></label> <button type="submit">＋ 加進待排</button></form><p class="sub">加進來之後，對 Claude 說「排這週」會把它拆成小塊排進去。</p></div>`;
  }

  /** 面板主體（每次改動後整塊重畫）。 */
  function bodyHtml(d: SData, nowMin: number, todayIso: string) {
    return `${nowHtml(d, nowMin)}<div class="week">${weekHtml(d)}</div>${deadlinesHtml(d, todayIso)}${historyHtml(d)}${inboxHtml(d)}`;
  }

  function menuHtml(d: SData, day: number, i: number) {
    const t = d.week[day]?.[i];
    if (!t) return "";
    const days = NAMES.map(
      (n, k) =>
        `<option value="${k}"${k === Math.min(6, day + 1) ? " selected" : ""}>${n}${d.dates[k] ? ` ${d.dates[k]}` : ""}</option>`,
    ).join("");
    const why = REASONS.map((r) => `<option>${r}</option>`).join("");
    const done =
      t.status === "done"
        ? ""
        : '<button type="button" data-act="done">✓ 做了</button> ';
    return `<li class="menu" role="group" aria-label="操作：${esc(t.text)}" data-day="${day}" data-i="${i}"><b>操作：${esc(t.text)}</b><div class="mrow">${done}<button type="button" data-act="drop">✕ 刪掉</button> <button type="button" data-act="small">▽ 改小（標記太大塊）</button></div><div class="mrow"><label>沒做的原因 <select name="reason"><option value="">（延後、刪掉要選一個）</option>${why}</select></label></div><div class="mrow"><label>到 <select name="day">${days}</select></label> <label>時間（選填） <input type="time" name="time"></label> <button type="button" data-act="postpone">→ 延後到那天</button> <button type="button" data-act="move">⇄ 移到那天</button></div><div class="mrow"><button type="button" data-act="close">取消</button></div></li>`;
  }

  /** 這個時刻在本週表的哪一欄（週一 = 0）；起始日有寫而且不在這週就是 -1。 */
  function colOf(d: SData, now: Date) {
    const wd = (now.getDay() + 6) % 7;
    if (!d.weekStart) return wd;
    const days = Math.round(
      (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
        utc(d.weekStart)) /
        86_400_000,
    );
    return days >= 0 && days < 7 ? wd : -1;
  }

  /** localStorage 可能整個不能用（隱私模式、file:// 限制）：取不到就當作沒有，不丟錯。 */
  function store(get: () => Storage) {
    return {
      load(key: string): string | undefined {
        try {
          return get().getItem(key) ?? undefined;
        } catch {
          return undefined;
        }
      },
      save(key: string, value: string): boolean {
        try {
          get().setItem(key, value);
          return true;
        } catch {
          return false;
        }
      },
      remove(key: string): void {
        try {
          get().removeItem(key);
        } catch {
          // 不能用就算了，畫面照常
        }
      },
    };
  }

  /** 資料的簽名：本週.md 變了（例如 Claude 已套用改動並重畫）就換，舊的暫存改動自動作廢。 */
  function signature(d: SData) {
    const s = JSON.stringify(d.week) + JSON.stringify(d.fixed);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }

  return {
    NAMES,
    REASONS,
    DEFAULT_MIN,
    fmt,
    hm,
    esc,
    segmentsOn,
    gapsOf,
    busy,
    capacity,
    canPlace,
    formatChange,
    parseChanges,
    applyChange,
    applyToMarkdown,
    dayRows,
    dayHtml,
    capHtml,
    weekHtml,
    counts,
    nowInfo,
    nowHtml,
    deadlinesHtml,
    historyHtml,
    inboxHtml,
    bodyHtml,
    menuHtml,
    colOf,
    store,
    signature,
  };
}

export type ScheduleLib = ReturnType<typeof scheduleLib>;
