import { parseGuardLog } from "../src/guard.ts";
import { LEARNED_FILE, SKILL_FOLDER } from "../src/fromcards.ts";
import { parseLearned, parseSkills } from "../src/library.ts";
import { buildModel } from "../src/model.ts";
import { paneTree } from "../src/pane.ts";
import { DEFAULT_DATA_DIR, expandHome } from "../src/paths.ts";
import { parseProfile } from "../src/profile.ts";
import { FIXED_FILE, WEEK_FILE, buildSchedule } from "../src/schedule.ts";

const PANE = "oasis-map";

const EMPTY = {
  goals: [],
  districts: [],
  errors: [],
  orphans: [],
  warnings: [],
};
let model = EMPTY;

const MISSING = /no such|ENOENT|not exist|not found|不存在/i;

/** 逐檔讀取：讀不到的檔進 errors（帶檔名），其他照畫。 */
async function readCards($, dir, errors) {
  const entries = await $.fs.list(dir);
  const cards = [];
  for (const f of entries.filter((e) => e.name.endsWith(".md"))) {
    try {
      cards.push({ file: f.name, text: await $.fs.read(`${dir}/${f.name}`) });
    } catch (err) {
      errors.push({ file: f.name, reason: `讀不到：${err.message}` });
    }
  }
  return cards;
}

async function readFolder($, dir, errors) {
  try {
    return await readCards($, dir, errors);
  } catch (err) {
    if (MISSING.test(err.message)) return [];
    if (dir.endsWith("/districts")) throw err;
    errors.push({ file: dir, reason: err.message });
    return [];
  }
}

async function readProfile($, root, errors) {
  try {
    return parseProfile(await $.fs.read(`${root}/profile.md`));
  } catch (err) {
    if (!MISSING.test(err.message)) {
      errors.push({ file: "profile.md", reason: `讀不到：${err.message}` });
    }
    return [];
  }
}

/** guard-log.md 有就畫城牆；讀不到不算錯（沒人被攔下過是好事）。 */
async function readGuard($, root) {
  try {
    return parseGuardLog(await $.fs.read(`${root}/guard-log.md`));
  } catch {
    return undefined;
  }
}

/** 學到的事.md 與 技能/ 有才放進 model；讀不到不算錯。 */
async function readLibrary($, root, errors) {
  let learned;
  try {
    learned = parseLearned(await $.fs.read(`${root}/${LEARNED_FILE}`));
  } catch {
    learned = undefined;
  }
  const cards = await readFolder($, `${root}/${SKILL_FOLDER}`, errors);
  return { learned, skills: cards.length > 0 ? parseSkills(cards) : undefined };
}

/** 時間/固定行程.md、時間/本週.md 有才放進 model；讀不到不算錯。 */
async function readSchedule($, root) {
  const read = async (file) => {
    try {
      return await $.fs.read(`${root}/${file}`);
    } catch {
      return undefined;
    }
  };
  return buildSchedule(await read(FIXED_FILE), await read(WEEK_FILE));
}

async function load($, dataDir) {
  const home = (await $.env.get("HOME")) ?? "";
  if (home === "" && dataDir.startsWith("~")) {
    model = fail(dataDir, "HOME 環境變數未定義，無法展開 ~");
    return;
  }
  const root = expandHome(dataDir, home);
  const unreadable = [];
  try {
    // 資料夾不存在＝空城（新使用者還沒開局）；其他錯誤照報
    const districts = await readFolder($, `${root}/districts`, unreadable);
    const goals = await readFolder($, `${root}/goals`, unreadable);
    model = buildModel(districts, goals);
    model.errors.push(...unreadable);
    model.strengths = await readProfile($, root, model.errors);
    model.guard = await readGuard($, root);
    Object.assign(model, await readLibrary($, root, model.errors));
    const { schedule, errors } = await readSchedule($, root);
    if (schedule) model.schedule = schedule;
    model.errors.push(...errors);
  } catch (err) {
    model = fail(`${root}/districts`, `讀不到資料夾：${err.message}`);
  }
}

function fail(file, reason) {
  return { ...EMPTY, errors: [{ file, reason }] };
}

/** context 填到這個百分比就提示一次（官方 `$.session.usage().context.percent`） */
const CONTEXT_WARN_PERCENT = 60;
const CONTEXT_WARN_TEXT =
  "對話快滿了：進度都存在綠洲裡，可以輸入 /clear 重新開始，回來說「繼續開局」或「更新地圖」";

export function register(on, options) {
  const dataDir = options?.data_dir || DEFAULT_DATA_DIR;
  let warned = false;

  on("turn.complete", async ($, e, next) => {
    if (!warned) {
      const { context } = await $.session.usage();
      if ((context.percent ?? 0) >= CONTEXT_WARN_PERCENT) {
        warned = true;
        $.ui.toast(CONTEXT_WARN_TEXT, { timeoutMs: 12000 });
      }
    }
    return next(e);
  });

  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "map", description: "打開綠洲城市地圖" });
    return next(e);
  });

  on("command.run", { command: "map" }, async ($) => {
    await load($, dataDir);
    await $.ui.open({
      id: PANE,
      title: "綠洲",
      focus: true,
      closeOnEscape: true,
    });
    $.ui.invalidate("ui.render");
    return {};
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const refresh = async () => {
      await load($, dataDir);
      $.ui.invalidate("ui.render");
    };
    return paneTree($.ui.resolve(e), e.surface, model, new Date(), refresh);
  });
}
