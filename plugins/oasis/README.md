# 綠洲（oasis）

綠洲是 Claude 的外掛：用一次一題的問答，幫你從做過的小事裡找出強項、選一個目標、定一個 7 天內做得完的小行動，再把這些畫成一座等角城市，每個目標是一座地標，每件在做的事是一棟建築。資料存在你自己連結的資料夾，對話由 Claude 處理。第一次用請先看「使用前先看」。

（以下為畫面規則，給想改程式的人）

把資料夾裡的 Markdown 卡片畫成一張等角城市地圖：每條「線」是一棟建築，每個目標是一座地標，道路顏色表示街區通往哪個目標。

畫面規則：路整格鋪滿、同色中線連到相鄰的同路格（轉角與路口自動接起來）；建築佔整數格、不站在路或水池上，光從左上來、影子往右下；休眠是實心褪色、施工中是實心方塊加鷹架線；「！」任務與 Lv 收在名稱膠囊裡；目標是 2×2 格的尖頂塔，街區房子是尖頂小屋。同一套畫圖程式同時輸出 Claude Code mod 的聊天旁 Pane（桌面 app／VS Code 畫 SVG 地圖，終端機退回文字清單）與單檔的 `map.html`。已知相容：Claude Code 2.1.317。

## 資料格式（v1）

設計原則：**每個東西都要對應地圖上的一棟建築或一條路**，沒有浮在地圖外的東西。資料夾 `<data_dir>`（預設 `~/workspace/oasis-city`，可用 `~` 開頭）有兩種卡片，格式都是開頭 frontmatter、內文隨意。

### `goals/*.md`：目標（地標）

```markdown
---
id: income # 必填，街區的 goal 用它指過來；不能叫 core
name: 拉高收入門檻 # 必填
kind: goal # 必填：endgame 終點（遠方宮殿，一張就好）｜goal 目標（地標）
landmark: tower # 選填：academy 學院（預設）｜tower 高塔
color: "#d98c2b" # 選填 #rrggbb；沒填就依序配色（endgame 固定土色）
---
```

### `districts/*.md`：街區（建築）

```markdown
---
name: 咖啡店打工
short: 咖啡店打工 # 選填，地圖標籤（超過 10 個全形字會截斷）
state: waiting # building 在建｜waiting 等你｜auto 自動運轉｜dormant 休眠
next: 下週班表還沒排，跟店長確認時段
since: 2026-10-23 # 算「等 N 天」
goal: income # goal id；auto 類可寫 core（接綠洲核心），auto 沒寫預設 core
building: studio # academy｜studio｜shop｜tent｜well｜windmill｜gate｜camp｜core；沒寫依 state 給預設
level: 2 # 選填 1–3 建築高度與 Lv 標；沒寫由 progress 推（<⅓ 為 1、<⅔ 為 2、其餘 3）
xp: { current: 26, target: 31, label: "升到 Lv.3：上滿 31 班" } # 選填，面板的 XP 條
quest: 回覆店長的班表訊息 # 等你時的任務一句話；沒寫就用 next
tile: [6, 1] # 選填，手動擺位；沒寫自動擺
due: 剩 3 件 # 選填，右側顯示文字（\n 換行）
progress: 0.72 # 選填 0–1，面板進度條（沒有 xp 時）
status_text: 今天 08:50 已送 # 選填，在建／自動運轉的狀態文字
---
```

- **孤兒**：`building`／`waiting` 的街區沒有 `goal`、或 goal 不存在 → 照樣畫出來但沒有道路，並在頁面上方「孤兒」提示區列出（Pane 底部也有）。`auto`／`dormant` 沒接目標不算孤兒。
- 道路顏色＝街區通往哪個目標；`goal: core` 的街區接到中央水池（青色）；`building: core` 的街區是水池旁的核心，自動連到每個目標。地圖底部有道路圖例。
- 向下相容 v0：舊卡沒有的欄位都有預設，沒有 `goals/` 資料夾也能畫（只是在建／等你的街區會是孤兒）。
- 壞檔（缺欄位、日期不存在、state／building 拼錯、level 不是 1–3）會被跳過，檔名與原因顯示在頁面／Pane，其他照常顯示。範例見 `examples/`。

## 使用前先看

綠洲是 Claude（Claude Code 或 Cowork）的外掛，用問答幫使用者盤點做過的事、找強項、定目標，再畫成一張城市地圖。它是個人開發者的專案（版本 0.1.0，私有，所有權利保留），不是 Anthropic 的產品。目標使用者是大學生。

### 年齡

綠洲要透過 Claude 帳號才能運作。Anthropic 消費者條款規定使用者須年滿 18 歲（或當地法定同意年齡，取較高者），隱私政策也寫明服務不以 18 歲以下為對象。**未滿 18 歲不能用個人帳號使用綠洲。** 學校若想讓未成年學生使用，必須透過學校與 Anthropic 簽訂的方案，並依 Anthropic「服務未成年人組織指引」做年齡把關、內容過濾與 AI 身分揭露；是否可行請向 Anthropic 確認。綠洲本身不做年齡檢查。

### 資料去哪裡

- 卡片、`profile.md`、`onboarding.md`、`學到的事.md`、`guard-log.md`、`map.html`：存在使用者連結的資料夾，能開這台電腦或這個雲端資料夾的人都看得到。
- 開局與回顧時說的每一句話、AI 讀取的卡片內容：送到 Anthropic 伺服器（Claude 處理對話必經；Cowork 雲端工作階段連開啟的本機檔都在雲端處理），依使用者與 Anthropic 的條款與隱私設定處理。
- 機會雷達的搜尋詞：送到網路搜尋服務，只放一般詞，不放姓名、學校、作品。

綠洲的地圖程式不連網，綠洲也不會把資料另外交給 Anthropic 以外的第三方。是否拿對話訓練模型、保存多久，由使用者的 Claude 方案與帳號隱私設定決定：個人方案允許訓練時保存五年，不允許則為 30 天；商業與教育方案不拿來訓練。請不要在對話中提到別人的姓名、家庭狀況或輔導內容。

### 學術誠信

綠洲可以幫你寫作業、報告和作品。每次交出可繳交的成品時，結尾都會附一句提醒：「交之前請自己看過、改成你的話，並照你學校或課堂的 AI 規定處理（例如要不要標註）。」作品盤點讀你貼的作業時，只列出看得到的事實。是否可以用 AI、要不要標註，由你的學校和老師決定，請先看課堂規定；Anthropic 使用政策（https://www.anthropic.com/legal/aup ）也列有「Plagiarize or submit AI-assisted work without proper permission or attribution」（未經許可或未標註就抄襲或繳交 AI 協助的作品）這一條。這條提醒是寫給 AI 的規則，沒有程式強制。

### 不讓使用者依賴 AI 的設計

一次只問一題；不打分數、不誇獎、不比較；強項要在 3 件不同的事出現才算，名字由使用者取；目標與行動由使用者拍板，AI 不推薦、不代選；每個行動 7 天內、約 30 分鐘做得完，做完回到現實生活產生新證據。綠洲不限制使用時間，也不取代和老師、家人、輔導老師的談話。

### 心情與危機

綠洲不是心理諮商或篩檢工具，也不保存心情或心理狀態的細節。使用者說出想傷害自己、被傷害或長期低落時，綠洲會停下流程，先用一句話接住他的情緒，再提供真人資源：安心專線 1925、生命線 1995、張老師 1980、學校輔導室，並問他要先停在這裡還是想繼續；他要繼續才接回流程，同一句中的非危機內容（例如打工）可以照常記，危機內容不寫進卡片或任何檔案。這同樣是寫給 AI 的規則，沒有程式強制；情況緊急請直接撥打 119 或 110。

### 刪除資料

1. 刪掉綠洲資料夾。
2. 在 Claude 刪除相關對話，並關閉或清除帳號記憶。
3. 移除外掛（`claude plugin uninstall oasis` 或 app 的外掛設定）。
4. 未成年人誤用時，家長可寫信到 privacy@anthropic.com 要求刪除。

### 責任與回報

綠洲依現狀提供，不擔保適合任何特定用途。Claude 的使用依使用者與 Anthropic 之間的條款處理。部分功能（Cowork 執行守衛、上傳用壓縮檔）尚未實機驗證。問題請回報給作者。

## 從空城開始

新使用者的資料夾 `~/workspace/oasis-city`（可在 plugin 設定 `data_dir` 改）一開始是空的：地圖是一片沙漠、中央一池水，寫著「跟 Claude 說『開局』，開始找你的綠洲」。資料夾不存在也一樣顯示空城，不報錯。

跟 Claude 說「開局」會觸發 `oasis-start` skill，一次一題帶你走四段：

1. 盤點：用具體小事收 3–5 件做過的事，並問你手上有沒有在經營的東西。
2. 找強項：同一類動作在 3 件事裡都出現才算，由你挑說法、你拍板，寫進 `profile.md`。
3. 找綠洲：依興趣與科系給 3 條路（科系延伸／強項跨界／放下面子的探索），你選一條成為第一個目標。
4. 開工：定一個 7 天內、約 30 分鐘的小行動，蓋第一棟建築；手上經營的東西也各蓋一棟，地圖重畫。

進度存在 `onboarding.md`，每段結束 Claude 會提醒進度已存好；對話快滿（context 約 60%）時，mod 也會跳一次提示（只在 Code 分頁；Cowork 沒有提示框），可輸入 `/clear` 開新對話，回來說「繼續開局」接著做。`profile.md` 格式：`## 強項名稱`，底下每件來源事件一行 `- 事件`；綠洲核心建築的面板會顯示強項與來源事件數。範例見 `skills/oasis-start/assets/onboarding-sample/`。

### 不用終端機（桌面 app／Cowork）

不需要 bun。`oasis-start` 與 `update-map` 兩個 skill 各附一份模板 `assets/viewer.html`，SKILL.md 以 `${CLAUDE_SKILL_DIR}/assets/viewer.html` 指到它，Claude 把它複製到使用者連結的資料夾、命名為 `map.html`。`map.html` 是單一檔案：畫圖程式（純瀏覽器 JS）、CSS 與城市資料全部內嵌，不連網、不需要伺服器，用 `file://` 雙擊就能開，畫面與 `build-map.ts` 同一套程式產生。

更新地圖時，Claude 只改寫檔內的資料區塊，其餘一個字都不動：

```js
// OASIS-DATA-START（城市資料：更新地圖時只改寫這兩行標記之間的內容）
window.OASIS_CARDS = [{"file":"districts/01-x.md","text":"卡片原文"}, ...];
// OASIS-DATA-END
```

資料行裡 `<` 一律寫成 `\u003c`，`OASIS-DATA` 字樣的連字號寫成 `\u002d`，所以卡片原文不會切斷頁面、也不會被誤認成標記。程式端的改寫與讀回在 `src/mapfile.ts`（`replaceDataBlock`／`readDataBlock`）。舊版的 `map.html`＋`city-data.js` 兩檔制已停用：skill 發現 `map.html` 沒有標記時會重新複製模板。

`${CLAUDE_SKILL_DIR}` 是官方的 skill 字串替換變數：「The directory containing the skill's SKILL.md file. For plugin skills, this is the skill's subdirectory within the plugin, not the plugin root.」，在 SKILL.md 內文與 `allowed-tools` 的 Bash 規則裡替換（來源：<https://code.claude.com/docs/en/skills>，「Available string substitutions」）。Cowork 會不會替換這個變數，官方沒寫，尚未實機驗證。

上傳用的壓縮檔：`bun scripts/pack.ts` 產生 `dist/oasis-plugin.zip`。打包前會自動檢查，任何一項不過就中止、不寫 zip：zip 內只有一份最上層 `.claude-plugin/plugin.json`；`name` 是小寫英數加連字號；沒有最上層 `bin/`（官方：claude.ai 與 Cowork 不安裝帶 `bin/` 的 plugin，<https://code.claude.com/docs/en/plugins-reference>「Standard layout」）；每個 `user_config` 替換引用都對得到有 `default` 的 `userConfig` 選項；兩份 viewer 模板都是單檔（資料區塊標記各一、沒有外部 script／stylesheet）。改了 `src/` 要先跑 `bun scripts/bundle-viewer.ts` 重打包模板。

### Cowork 版 vs Code 分頁版

|                              | Cowork                              | Claude Code 程式分頁（CLI／桌面 app Code 分頁／VS Code） |
| ---------------------------- | ----------------------------------- | -------------------------------------------------------- |
| 看地圖                       | 只有資料夾裡的 `map.html`（雙擊開） | `map.html`，加上聊天旁的 `/oasis:map` 側邊面板（Pane）   |
| 提示框                       | 沒有（對話快滿的提示不會跳）        | 有（context 約 60% 時跳一次提示）                        |
| skill（開局、收工、週回顧…） | 有                                  | 有                                                       |
| 資料夾                       | 使用者在 app 裡連結的資料夾         | plugin 設定 `data_dir`（預設 `~/workspace/oasis-city`）  |
| 重畫方式                     | Claude 改寫 `map.html` 的資料區塊   | 同左，或 `bun scripts/build-map.ts`                      |

Cowork 不支援 mods，所以側邊面板（Pane）與提示框（toast）只在 Code 分頁出現；兩邊的 `map.html` 是同一份。

### 隱私告知

Cowork 讀到的本機檔案會在 Anthropic 伺服器處理。Pro 方案新開的 Cowork 任務在 Anthropic 雲端執行，Claude 讀取你連結資料夾裡的卡片、`profile.md`、`學到的事.md` 等內容時，這些內容會送到 Anthropic 的伺服器處理。請不要把不想讓 AI 讀的東西（金鑰、密碼、他人的個資）放進這個資料夾。`oasis-start` 第一次開局時也會用白話提醒一次。綠洲本身不把資料傳給 Anthropic 以外的第三方（見下方 R6）。

## 自我學習：學到的事與技能庫

plugin 的 skill 是從 GitHub 來的靜態檔，使用者端改不了，所以學習成果一律存在使用者的資料夾，地圖的「圖書館」（HUD 的「學到 N 條・技能 N 個」，點開看內容）會顯示它們。

### `學到的事.md`

每條經驗一個 `## 一句話規則`，底下三行：

```markdown
### 圖書館建築與 Pane

- 學到的事＋技能合計 1 條以上，主地面上會多出一棟人字屋頂的「圖書館」（佔一格，不壓路與水池；0 條不蓋）；點它，右側面板列出所有標題。外觀隨條數成長：1–5 條小屋、6–15 條加高、16 條以上加圓頂（門檻是 `src/library-building.ts` 的 `LIBRARY_TIERS`）。
- `bun scripts/build-map.ts` 產生的 map.html 與 Claude 從 `assets/viewer.html` 複製、改寫資料區塊的 map.html 是同一份格式，畫的是同一棟。改了 `src/` 要跑 `bun scripts/bundle-viewer.ts` 重打包 viewer。
- `/oasis:map` Pane（終端機退回文字）多一個精簡區塊：條數，加學到的事、技能各最新 3 條標題。
- 截圖：`design/library-map.png`、`design/library-viewer.png`、`design/library-empty.png`（空城不畫）。

## 先講結論，再講細節

- 日期：2026-11-04
- 起因：他說「你每次都講一大串，我看不完」
- 怎麼用：回答第一句就是結論，細節他問再給
```

收工（`update-map`）時 Claude 回想這次對話：被糾正什麼、什麼有效、哪類問題答不出來，最多提 2 條候選，**使用者同意才寫**；過時的條目只提議刪除。

### `技能/<名稱>.md`

資料型技能，只是一份寫著步驟的說明，不會自己執行。開頭 `name`、`when`（什麼情況用）、`source`（自己造或網址）、`created`，內文是步驟。由 `oasis-skills` skill 管理：做事前查索引、同類事第 3 次出現時提議存成技能、使用者貼連結說「我要這個」時改寫並給他看全文、同意才存；要求讀機密、對外寄送、改防護層、下載執行程式的內容一律拒收。範例見 `skills/oasis-start/assets/onboarding-sample/`。

### 開場注入

plugin 的 SessionStart hook（`scripts/session/start.sh`）在對話開頭把 `學到的事.md` 全文與 `技能/` 的索引（檔名＋`when`）放進對話；檔案不存在就什麼都不印。總量上限 4096 位元組，超過就在行尾截斷並提示。Cowork 會不會執行 SessionStart 未實機驗證，所以每個 skill 第一步也都寫了「先讀 學到的事.md」當備援。寫入 `技能/` 不會被守衛 R4 攔（R4 只看 `skills/`、`plugins/`）。

### 使用者技能

- `oasis-weekly` 週回顧：這週做了什麼 → 對應建築加經驗、改下一步 → 下週 7 天小行動 → 重畫地圖。
- `oasis-portfolio` 作品盤點：只講看得到的事實與證據，強項由使用者命名，寫進 `profile.md`。
- `oasis-radar` 機會雷達：依強項找比賽、獎項、接案，附來源網址與截止日；使用者選的才變成建築的任務，不代為報名、不送個資。

## 安全

綠洲附一組「城牆守衛」，用 plugin 的 hook 在每次 AI 動手前先檢查；Claude Code 和 Cowork 都會執行（Cowork 能不能跑 `sh` 腳本尚未實機驗證）。白話版規則：

- 機密檔盡量不讀（R1）：`.ssh`、`.aws`、`.env`、`.pem`、`.key`、`credentials`、`id_rsa`、gh／Claude／npm／docker／kube／gcloud 憑證、瀏覽器密碼庫與 cookie、shell history、`/proc/*/environ` 等，指令或工具的路徑字面對得上就擋；Grep／Glob 搜整個家目錄也擋。`.env.example` 這種範本不擋。**擋不住**用引號拼接、萬用字元、base64 或 `python -c` 之類任意程式碼讀檔的寫法。
- 對外動作分兩級（R2／R7，安全規則 v2）：**直接擋下、連「全部允許」模式也擋（R7）**：推到公開的 repo（查不到是不是私人也當公開，擋下時會告訴你怎麼自己手動推）、改 repo 公開／私人設定、發佈套件（npm publish、twine upload、cargo publish、docker push 等）、付款、改 git remote／ANTHROPIC_BASE_URL／代理設定、開 tunnel（ngrok、cloudflared、localtunnel、ssh -R 等）、把 token 或金鑰印出來或送出去。**跳出確認由你決定（R2）**：推到自己的私人 repo、留言、寄信、發文、分享、刪除檔案。「對新收件人寄信」刻意不擋（守衛無法可靠判斷誰是新收件人），維持詢問。判斷 repo 是否私人要用 `gh`（GitHub 命令列工具）並登入。
- 讀過外部內容後，送資料出去要問（R3）：這段對話讀過網頁、信件、issue 或遠端 repo 之後，帶網址的指令、腳本連網、DNS 工具、開瀏覽器、WebFetch、非唯讀的 MCP 工具都先問你；**無人值守時（權限模式是 dontAsk，或啟動時設了環境變數 `OASIS_UNATTENDED=1`）直接擋下**。同一段對話裡你允許過（工具真的執行了）的網域會記住，之後連同一個網域不再問；但網址帶長亂碼、指令裡有 `$` 或反引號、或看不出目的地時照樣問。localhost、127.0.0.1、::1 不算外送；WebSearch 只在查詢字串夾帶 24 字以上的 base64／hex 亂碼時問；git commit 的 `-m` 訊息與程式註解裡的網址不算。「讀過」只從守衛看得到的工具呼叫判斷，所以讀之前的第一次連網不會問。
- 裝技能先問你（R4）：要把東西放進 `skills/`、`plugins/` 時，請你確認來源。
- 防護層 AI 不能改（R5）：家目錄的 `~/.claude`、任何 `settings*.json`、`.claude` 底下的 hooks 與 plugins、綠洲自己的檔案，AI 一律不能寫，指令碰到這些路徑也擋；專案資料夾裡的 `.claude` 可以用 cat、ls、grep 讀，改 `.claude/commands`、`.claude/agents` 會先問你，改其他地方照樣擋；在殼層再開 `claude --settings`、`-p`、`--dangerously-skip-permissions`，或 `claude plugin disable|uninstall|remove` 也擋。
- 個資不外流到第三方（R6）：側寫、強項這類內容只寫進你的資料夾，不貼到網頁、搜尋或其他外部服務，也不保存心情或心理狀態的細節。這條是寫給 AI 的規則，沒有腳本強制執行。注意：對話本身一定會送到 Anthropic 給 Claude 處理，詳見「使用前先看」的「資料去哪裡」。

每次擋下或先問，會在資料夾的 `guard-log.md` 記一行（只寫日期、規則、白話摘要，不寫指令內容），地圖邊緣的城牆守衛會顯示最近 5 筆和總數。守衛的定位是**第二層防護加紀錄**，不是完整保護：真正的防線是 Claude Code 的 sandbox 與 permissions（見下方「建議貼進 settings.json」）。已知限制：守衛只看路徑和指令字面，空引號、萬用字元、base64、`python -c` 等寫法擋不到（`tests/guard/guard.spec.ts` 以 `test.todo` 列出，標明需要 sandbox）；原生 Windows 沒有 sandbox，只剩守衛與詢問視窗；腳本壞掉時，機密與防護層規則改成直接擋下，其他規則改成先問。腳本在 `scripts/guard/`，只用 sh、grep、sed，不需要 bun、node、jq、python。

### 建議貼進 settings.json 的系統層防護

外掛不能帶 sandbox 或 permissions 設定，所以 `oasis-start` 在第一次存檔時會問使用者要不要看一段建議設定（`sandbox.enabled`、`filesystem.denyRead`、`network.allowedDomains`、`permissions.deny`），**只給文字、由使用者自己貼進 `~/.claude/settings.json`，skill 不會改他的設定**。完整文字見 `skills/oasis-start/SKILL.md` 的「安全設定」。原生 Windows 沒有 sandbox，只有權限詢問視窗、沒有隔離，建議用 WSL2；守衛在那裡只是第二層防護與紀錄。hooks 的 `onFailure` 需要 Claude Code v2.1.295 以上。

## 試跑

```bash
claude --plugin-dir ~/workspace/oasis   # 然後輸入 /oasis:map 開 Pane
bun scripts/build-map.ts [資料夾]        # 產生單檔 <資料夾>/map.html，預設 ~/workspace/oasis-city
bun scripts/pack.ts                      # 打包前檢查＋dist/oasis-plugin.zip
bun test                                 # 解析、孤兒、擺位、道路連通、渲染
claude plugin test                       # mod 測試（mod-tests/）
claude plugin validate .
```

## 預裝 skill

- `oasis-start`：開局，一次一題盤點做過的事。
- `oasis-portfolio`：作品盤點，先講事實、名字由你挑。
- `oasis-radar`：機會雷達，依強項找比賽、獎項、接案。
- `oasis-weekly`：週回顧，加經驗並排下週 7 天的小行動。
- `oasis-research`：找資料整理，每條附來源、不確定標「未驗證」。
- `oasis-resume`：履歷與自介草稿，每句連回你資料夾裡的事實。
- `oasis-plan`：時間規劃，拆成約 30 分鐘的小行動寫回卡片。
- `oasis-time`：時間管家，依你的固定行程算真正可用時間，只排約六成，每次滾動調整。排好的行程寫在 `時間/`，`map.html` 的鐘樓點開就是一週行程表，Claude Code 的 Pane 也會列出今天的時段。
- `oasis-slides`：簡報大綱，排結構與每頁問題，可寫講稿，交出成品附交件提醒。
- `oasis-video`：影片剪輯，先檢查有沒有 ffmpeg，沒有就教外部工具；只輸出新檔。
- `oasis-ig`：IG 創作工作室，從有證據的強項提系列候選、拆成小行動、只跟自己比的複盤、業配入門（外部事實附來源）。
- `oasis-skills`：技能庫。`update-map`：更新地圖。

## 結構

- `src/`：純函式。`parse` → `model`（配色、孤兒）→ `layout`（擺位、道路、圖例）→ `svg`（純函式回傳 SVG 字串，建築畫法在 `sprites.ts`）／`view`（清單）→ `page`（HTML）／`pane`（Pane 元素樹）。擺位用的建築範圍與畫法共用同一組數字（`sprites.ts`），所以標籤不會被建築蓋住。
- `hooks/oasis.ts`：mod 入口，只做讀檔與註冊指令。
- `src/mapfile.ts`：單檔 map.html 的模板與資料區塊改寫。
- `skills/*/assets/`：skill 附檔（`viewer.html` 模板；`oasis-start` 另附範例 `onboarding-sample/`）。
- `scripts/`：產生 `map.html`、重打包模板、打包 zip。設計稿在 `design/`。

## 授權

私有專案，**所有權利保留**：未經作者書面授權，不得重製、修改或散布，詳見 `LICENSE`。第三方程式碼與借鏡來源見 `THIRD_PARTY_NOTICES`。本專案與 Anthropic 無隸屬關係。
