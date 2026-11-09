import type { Change, ScheduleLib, SData } from "./schedule-lib.ts";

interface FolderHandle {
  name: string;
  getDirectoryHandle(name: string): Promise<FolderHandle>;
  getFileHandle(name: string): Promise<{
    getFile(): Promise<{ text(): Promise<string> }>;
    createWritable(): Promise<{
      write(s: string): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}
type Win = Window & {
  showDirectoryPicker?: (o: { mode: string }) => Promise<FolderHandle>;
};

/**
 * 行程表面板在瀏覽器裡的互動：按一塊開操作選單、拖曳換日子、暫存改動、專注計時器。
 * 和 schedule-lib 一樣會被 `toString()` 塞進頁面，所以只能用參數 L 和瀏覽器全域物件。
 */
export function scheduleClient(L: ScheduleLib): void {
  const pane = document.querySelector<HTMLElement>(".pane.sched");
  const raw = document.getElementById("sched-data");
  if (!pane || !raw) return;
  const win = window as Win;
  const body = pane.querySelector<HTMLElement>(".sbody") as HTMLElement;
  const bar = pane.querySelector<HTMLElement>(".pending") as HTMLElement;
  const msgEl = pane.querySelector<HTMLElement>(".msg") as HTMLElement;
  const tools = pane.querySelector<HTMLElement>(".tools") as HTMLElement;
  const original = raw.textContent || "{}";
  let D: SData = JSON.parse(original);
  D.today = L.colOf(D, new Date());
  const storage = L.store(() => window.localStorage);
  const key = `oasis-time:${L.signature(D)}`;
  let pending: Change[] = [];
  let menu: { day: number; i: number } | undefined;
  let canStore = true;

  // 上次沒存回的改動：資料簽名相同才還原（本週.md 變了就作廢）
  try {
    const saved = JSON.parse(storage.load(key) || "[]") as Change[];
    for (const c of saved) if (L.applyChange(D, c).ok) pending.push(c);
  } catch {
    pending = [];
  }

  const clock = () => {
    const t = new Date();
    return {
      min: t.getHours() * 60 + t.getMinutes(),
      iso: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`,
    };
  };
  const say = (text: string) => {
    msgEl.textContent = text;
  };

  function renderBar() {
    if (pending.length === 0) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    const list = pending.map((c) => L.formatChange(D, c)).join("\n");
    const save =
      win.showDirectoryPicker && window.isSecureContext
        ? ' <button type="button" data-act="save">直接存回資料夾</button>'
        : "";
    const warn = canStore
      ? ""
      : "（這個瀏覽器不能暫存，重新整理會不見，請先複製）";
    bar.hidden = false;
    bar.innerHTML = `<b>◆ 有 ${pending.length} 個改動還沒存回</b> <button type="button" data-act="copy">複製給 Claude</button>${save} <button type="button" data-act="revert">放棄這些改動</button><details><summary>看改動清單</summary><textarea readonly rows="${Math.min(8, pending.length + 1)}" aria-label="改動清單">${L.esc(list)}</textarea></details><p class="sub">把清單貼給 Claude，它會更新 時間/本週.md 並重畫地圖。${warn}</p>`;
  }

  function render() {
    const now = clock();
    body.innerHTML = L.bodyHtml(D, now.min, now.iso);
    if (menu) {
      const row = body.querySelector(
        `li.tk[data-day="${menu.day}"][data-i="${menu.i}"]`,
      );
      row?.insertAdjacentHTML("afterend", L.menuHtml(D, menu.day, menu.i));
    }
    const c = L.counts(D);
    const lv = pane?.querySelector(".lv");
    if (lv) lv.textContent = `本週排 ${c.planned} 塊、做了 ${c.done} 塊`;
    renderBar();
    renderTimer();
  }

  function persist() {
    canStore = storage.save(key, JSON.stringify(pending));
    if (pending.length === 0) storage.remove(key);
  }

  /** 套用並記下一筆改動；放不進去就說原因、資料不動。 */
  function commit(c: Change): boolean {
    const v = L.applyChange(D, c);
    if (!v.ok) {
      say(`✕ 放不進去：${v.reason}`);
      return false;
    }
    pending.push(c);
    menu = undefined;
    persist();
    say("✓ 已記下，還沒存回；上方可以複製給 Claude");
    render();
    return true;
  }

  const timeOf = (v: string) => {
    if (!v) return undefined;
    const [h, m] = v.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };

  function fromMenu(act: string, li: HTMLElement) {
    const day = Number(li.dataset.day);
    const i = Number(li.dataset.i);
    const text = D.week[day]?.[i]?.text ?? "";
    const field = (n: string) =>
      (li.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    const reason = field("reason") || undefined;
    if ((act === "postpone" || act === "drop") && !reason) {
      say("✕ 還沒選原因：請先選「沒做的原因」");
      return;
    }
    const base = { day, idx: i, text };
    if (act === "done") commit({ ...base, kind: "done" });
    else if (act === "small")
      commit({ ...base, kind: "small", reason: "太大塊" });
    else if (act === "drop") commit({ ...base, kind: "drop", reason });
    else
      commit({
        ...base,
        kind: act === "move" ? "move" : "postpone",
        toDay: Number(field("day")),
        toTime: timeOf(field("time")),
        reason: act === "move" ? undefined : reason,
      });
  }

  async function saveToFolder() {
    try {
      const picked = await (
        win.showDirectoryPicker as NonNullable<Win["showDirectoryPicker"]>
      )({ mode: "readwrite" });
      const dir =
        picked.name === "時間"
          ? picked
          : await picked.getDirectoryHandle("時間");
      const file = await dir.getFileHandle("本週.md");
      const md = await (await file.getFile()).text();
      const out = L.applyToMarkdown(md, D, pending);
      const w = await file.createWritable();
      await w.write(out.text);
      await w.close();
      pending = pending.filter((c) =>
        out.skipped.includes(L.formatChange(D, c)),
      );
      persist();
      render();
      say(
        out.skipped.length > 0
          ? `✓ 已存回 時間/本週.md；有 ${out.skipped.length} 個改動要請 Claude 處理，用「複製給 Claude」`
          : "✓ 已存回 時間/本週.md；對 Claude 說「更新地圖」才會重畫這張圖",
      );
    } catch (err) {
      say(
        `✕ 沒有存成：${err instanceof Error ? err.message : "已取消"}（可改用「複製給 Claude」）`,
      );
    }
  }

  function copyList() {
    const text = pending.map((c) => L.formatChange(D, c)).join("\n");
    const area = bar.querySelector("textarea");
    const showList = () => {
      const det = bar.querySelector("details");
      if (det) det.open = true;
      area?.select();
      say("請手動複製上面清單，貼給 Claude");
    };
    if (!navigator.clipboard) return showList();
    navigator.clipboard
      .writeText(text)
      .then(
        () => say(`✓ 已複製 ${pending.length} 行，貼給 Claude 就好`),
        showList,
      );
  }

  // ---- 專注計時器：只在頁面內提示 ----
  const timer = {
    left: 1800,
    running: false,
    handle: 0,
    task: "",
    asking: false,
  };
  const mmss = () =>
    `${String(Math.floor(timer.left / 60)).padStart(2, "0")}:${String(timer.left % 60).padStart(2, "0")}`;

  function renderTimer() {
    const list = (D.week[D.today] ?? [])
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.status === "todo" && !x.t.gone);
    const opts = list
      .map(
        (x) =>
          `<option value="${x.i}"${String(x.i) === timer.task ? " selected" : ""}>${L.esc(x.t.text)}</option>`,
      )
      .join("");
    const ask = timer.asking
      ? `<p class="ask" role="status"><b>做完了嗎？</b> ${timer.task ? '<button type="button" data-act="t-done">✓ 做了</button> <button type="button" data-act="t-later">→ 延後…</button> ' : ""}<button type="button" data-act="t-skip">先放著</button></p>`
      : "";
    tools.innerHTML = `<span class="tm"><b>◷ 30 分鐘專注</b> <output aria-live="off">${mmss()}</output> <label>做這件 <select name="task"><option value="">（不指定）</option>${opts}</select></label> <button type="button" data-act="t-start">${timer.running ? "暫停" : "開始"}</button> <button type="button" data-act="t-end">結束</button></span> <button type="button" data-act="print">列印這週</button>${ask}`;
  }

  function stopTimer(finished: boolean) {
    clearInterval(timer.handle);
    timer.running = false;
    timer.asking = true;
    timer.left = 1800;
    say(finished ? "◷ 30 分鐘到了（只在這個頁面提醒）" : "◷ 已結束這一段");
    renderTimer();
  }

  function toggleTimer() {
    timer.asking = false;
    const sel = tools.querySelector<HTMLSelectElement>("[name=task]");
    if (sel) timer.task = sel.value;
    if (timer.running) {
      clearInterval(timer.handle);
      timer.running = false;
    } else {
      timer.running = true;
      timer.handle = window.setInterval(() => {
        timer.left -= 1;
        if (timer.left <= 0) stopTimer(true);
        else {
          const out = tools.querySelector("output");
          if (out) out.textContent = mmss();
        }
      }, 1000);
    }
    renderTimer();
  }

  function timerAnswer(act: string) {
    const i = Number(timer.task);
    const text = D.week[D.today]?.[i]?.text ?? "";
    timer.asking = false;
    if (act === "t-done" && timer.task) {
      commit({ kind: "done", day: D.today, idx: i, text });
    } else if (act === "t-later" && timer.task) {
      menu = { day: D.today, i };
      render();
    } else renderTimer();
  }

  // ---- 事件 ----
  pane.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act as string;
    if (act === "menu") {
      menu = { day: Number(btn.dataset.day), i: Number(btn.dataset.i) };
      say("");
      render();
      body.querySelector<HTMLElement>(".menu button")?.focus();
    } else if (act === "close") {
      menu = undefined;
      render();
    } else if (["done", "drop", "small", "postpone", "move"].includes(act)) {
      fromMenu(act, btn.closest("li.menu") as HTMLElement);
    } else if (act === "copy") copyList();
    else if (act === "save") void saveToFolder();
    else if (act === "revert") {
      D = JSON.parse(original);
      D.today = L.colOf(D, new Date());
      pending = [];
      menu = undefined;
      persist();
      say("已放棄這些改動，回到存檔的樣子");
      render();
    } else if (act === "print") window.print();
    else if (act === "t-start") toggleTimer();
    else if (act === "t-end") stopTimer(false);
    else timerAnswer(act);
  });

  pane.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.name === "task") timer.task = el.value;
  });

  pane.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const text = (
      form.elements.namedItem("text") as HTMLInputElement
    ).value.trim();
    const due = (form.elements.namedItem("due") as HTMLInputElement).value;
    if (!text) {
      say("✕ 先寫一件事再加進待排");
      return;
    }
    const md = due ? `${due.slice(5, 7)}/${due.slice(8, 10)}` : undefined;
    commit({ kind: "add", day: 0, text, due: md });
  });

  // 拖曳：放到某天、某個空檔或固定行程上；放不進去就拒絕並說原因
  pane.addEventListener("dragstart", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>(
      "li.tk[draggable]",
    );
    if (li && e.dataTransfer) {
      e.dataTransfer.setData("text/plain", `${li.dataset.day}:${li.dataset.i}`);
    }
  });
  pane.addEventListener("dragover", (e) => {
    if ((e.target as HTMLElement).closest(".day")) e.preventDefault();
  });
  pane.addEventListener("drop", (e) => {
    const target = e.target as HTMLElement;
    const sec = target.closest<HTMLElement>(".day");
    const from = e.dataTransfer?.getData("text/plain").split(":").map(Number);
    if (!sec || !from || from.length !== 2) return;
    e.preventDefault();
    const [day, i] = from as [number, number];
    const t = D.week[day]?.[i];
    if (!t) return;
    const row = target.closest<HTMLElement>("li[data-at]");
    commit({
      kind: "move",
      day,
      idx: i,
      text: t.text,
      toDay: Number(sec.dataset.day),
      toTime: row ? Number(row.dataset.at) : t.time,
    });
  });

  // 打開面板時跳到今天；現在／下一塊每半分鐘更新
  new MutationObserver(() => {
    if (!pane.hidden) {
      body
        .querySelector(".day.today")
        ?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }).observe(pane, { attributes: true, attributeFilter: ["hidden"] });
  window.setInterval(() => {
    const box = body.querySelector(".nowbox");
    if (box) box.outerHTML = L.nowHtml(D, clock().min);
  }, 30_000);

  render();
}
