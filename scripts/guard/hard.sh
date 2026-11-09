#!/bin/sh
# 硬規則：R1 機密檔不讀、R5 防護層不能被 AI 改。有事印一行 deny。
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
guard_load
TOOL=$(json_field tool_name)
tool_unrecognized "$TOOL" && hit deny R1/R5 "擋下：無法辨識工具名稱" "${TOOL_REASON}先不放行（規則 R1/R5）。"
set -f
IFS='
'

# 指令本身會洩漏機密：印出整份環境變數、讀鑰匙圈。
leaks_secrets() {
  printf '%s' "$1" | grep -Eq '(^|[;&|(`])[[:space:]]*(printenv|env)([[:space:]]+-[a-z0-9-]+)*[[:space:]]*($|[;&|>)])' && return 0
  printf '%s' "$1" | grep -Eq '(^|[[:space:];&|(`])security[[:space:]]+(find-generic-password|find-internet-password|dump-keychain)' && return 0
  return 1
}

# Grep／Glob 的搜尋範圍是家目錄或更上層（沒寫路徑就看 cwd）：整個家目錄一次翻完等於繞過機密清單。
home_scope_scan() {
  _sp=$1
  case $_sp in "" | .) _sp=$(field cwd) ;; esac
  is_home_or_above "$_sp" && hit deny R1 "擋下：想一次搜整個家目錄" "$R1_HOME_REASON"
}

# 本 plugin 根目錄：轉小寫、反斜線換成 /、去掉磁碟機代號，格式才對得上被切過的詞。
PLUGIN_ROOT=$(printf '%s' "${CLAUDE_PLUGIN_ROOT:-}" | tr 'A-Z\\' 'a-z/' | sed 's/^[a-z]://')

R1_REASON="這個檔案放的是密碼或金鑰這類機密，綠洲不讓 AI 讀（規則 R1）。真的需要的話，請你自己打開看。"
R1_HOME_REASON="這會一次翻遍整個家目錄，裡面有金鑰和密碼，綠洲不讓 AI 這樣搜（規則 R1）。請指定要搜的資料夾，例如你的綠洲資料夾。"
R5_REASON="這會動到防護設定，綠洲不讓 AI 改（規則 R5）。要改請你自己動手。"

# 這個詞是不是機密檔的路徑？$2=1 表示整個欄位就是一個檔名（Read），單獨的 credentials 也算。
is_secret() {
  t=$1
  b=${t##*/}
  case $t in
    .ssh | .ssh/* | */.ssh | */.ssh/* | .aws | .aws/* | */.aws | */.aws/* | .gnupg | .gnupg/* | */.gnupg | */.gnupg/*) return 0 ;;
  esac
  case $t in
    .config/gh | .config/gh/* | */.config/gh | */.config/gh/* | .kube | .kube/* | */.kube | */.kube/*) return 0 ;;
    .docker/config.json | */.docker/config.json | */.config/gcloud | */.config/gcloud/* | */.gcloud | */.gcloud/*) return 0 ;;
    .git/config | */.git/config | /proc/*/environ) return 0 ;;
    */google-chrome | */google-chrome/* | */chromium | */chromium/* | */brave-browser/* | */microsoft-edge/*) return 0 ;;
    */google/chrome/* | */.mozilla | */.mozilla/* | */library/keychains/*) return 0 ;;
  esac
  case $b in
    .npmrc | .pypirc | .credentials.json | application_default_credentials.json | logins.json | key3.db | key4.db) return 0 ;;
    .*_history | .history | consolehost_history.txt | *.env) return 0 ;;
    .env.example | .env.sample | .env.template | .env.dist | .env.defaults) return 1 ;;
    .env | .env.* | *.pem | *.key | *.p12 | *.pfx | wallet.dat | .netrc | .git-credentials | .pgpass) return 0 ;;
    id_rsa.pub | id_ed25519.pub | id_ecdsa.pub | id_dsa.pub) return 1 ;;
    id_rsa | id_rsa.* | id_ed25519 | id_ed25519.* | id_ecdsa | id_ecdsa.* | id_dsa | id_dsa.*) return 0 ;;
    cookies.sqlite | cookies.sqlite-*) return 0 ;;
    gw-keys | x-keys | credentials | credentials.*) if [ "$2" = 1 ] || [ "$t" != "$b" ]; then return 0; fi ;;
    cookies | cookies-journal) [ "$t" != "$b" ] && return 0 ;;
  esac
  return 1
}

r1_scan() {
  for w in $(guard_tokens "$1"); do
    is_secret "$w" "$2" && hit deny R1 "擋下：想讀機密檔" "$R1_REASON"
  done
}

# 防護層的路徑：.claude 目錄（Write／Edit 用；Bash 走下面的分級）、本 plugin 自己的檔案、守衛日誌與旗標。
is_protected() {
  case $1 in
    .claude | .claude/* | */.claude | */.claude/* | .claude.json | */.claude.json) return 0 ;;
  esac
  is_guard_path "$1"
}

is_guard_path() {
  case $1 in
    */oasis/hooks/* | */oasis/scripts/guard/* | */oasis/.claude-plugin/* | */oasis-market/* | */guard-log.md | */oasis-guard | */oasis-guard/*) return 0 ;;
  esac
  [ -n "$PLUGIN_ROOT" ] && case $1 in "$PLUGIN_ROOT" | "$PLUGIN_ROOT"/*) return 0 ;; esac
  return 1
}

R5_ASK_REASON="這會改專案裡的 .claude/commands 或 .claude/agents（自訂指令與代理），請先確認內容（規則 R5）。"

# 專案內 <cwd>/.claude 的位置分級。印出 cmd（commands／agents 底下）、proj（專案 .claude 其他地方）或 deny。
# deny：家目錄那份 ~/.claude、任何 settings*.json、hooks、plugins、有 ..、相對路徑但指令裡有 cd、解開連結後跑到專案外。
# $1 是原樣（未轉小寫）的路徑，$2=1 表示指令裡有 cd／pushd。
claude_class() {
  _w=$(printf '%s' "$1" | tr '\\' '/')
  _lw=$(printf '%s' "$_w" | lower)
  case $_lw in *.claude.json) echo deny; return ;; esac
  case ${_lw##*/} in settings*.json) echo deny; return ;; esac
  case /$_lw/ in */../* | */.claude/hooks/* | */.claude/plugins/*) echo deny; return ;; esac
  _cwd=$(json_field cwd | json_plain)
  [ -n "$_cwd" ] || { echo deny; return; }
  case $_w in
    ./.claude | ./.claude/*) _w=${_w#./} ;;
  esac
  case $_w in
    .claude | .claude/*)
      [ "$2" = 1 ] && { echo deny; return; }
      _w="${_cwd%/}/$_w"
      ;;
    /*) ;;
    *) echo deny; return ;;
  esac
  _proj=$(real_path "${_cwd%/}/.claude" | lower)
  _real=$(real_path "$_w" | lower)
  _home=$(printf '%s' "${HOME:-}" | tr 'A-Z\\' 'a-z/')
  _home="${_home%/}/.claude"
  # 專案的 .claude 本身是符號連結（例如指到 ~/.claude）就不當專案內。
  [ "$_proj" = "$(real_path "$_cwd" | lower)/.claude" ] || { echo deny; return; }
  case $_proj in "$_home" | "$_home"/*) echo deny; return ;; esac
  case $_real in "$_home" | "$_home"/*) echo deny; return ;; esac
  case $_real in
    "$_proj"/commands | "$_proj"/commands/* | "$_proj"/agents | "$_proj"/agents/*) echo cmd ;;
    "$_proj" | "$_proj"/*) echo proj ;;
    *) echo deny ;;
  esac
}

# 指令是不是「只讀」：每一段（; & | ( ) 分開）都以唯讀指令開頭，而且沒有寫檔導向。
cmd_is_read() {
  cmd_writes "$1" && return 1
  printf '%s' "$1" | grep -Eq '(^|[[:space:]])(-delete|-exec|-execdir|-ok|-okdir|-fprint[0-9]*|-fls|--pre)([[:space:]=]|$)' && return 1
  printf '%s' "$1" | grep -Eq '(^|[[:space:];&|(])tree[[:space:]].*[[:space:]]-o' && return 1
  for _seg in $(printf '%s' "$1" | tr ';&|()`' '\n\n\n\n\n\n'); do
    _first=$(printf '%s' "$_seg" | sed 's/^[[:space:]]*//; s/[[:space:]].*//')
    case $_first in
      "" | cat | ls | grep | egrep | fgrep | rg | head | tail | wc | tree | stat | file | diff | find | echo | printf | pwd | true) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

r5_scan() {
  for w in $(guard_tokens "$1"); do
    is_protected "$w" && hit deny R5 "擋下：想改防護設定" "$R5_REASON"
  done
}

# 本 plugin 根目錄的真正位置（小寫、/ 分隔、去磁碟機代號）。沒設 CLAUDE_PLUGIN_ROOT 就用本腳本往上兩層。
src_root() {
  _sr=${CLAUDE_PLUGIN_ROOT:-}
  [ -n "$_sr" ] || _sr=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd -P)
  [ -n "$_sr" ] || return 0
  real_path "$(printf '%s' "$_sr" | tr '\\' '/')" | lower | sed 's/^[a-z]://; s:/*$::'
}

# 把 Bash 指令照殼層規則切段、切詞，找出 cp／cat／install 的「來源」（只被讀的運算元）。
# $1=list：印出候選來源（~ 展開、\ 換成 /），一行一個。
# $1=strip：$2 是已確認在 plugin 目錄裡的來源清單；印出拿掉這些來源詞後的指令（\ 換成 /）。
# 看不準就一個都不拿：整條指令有 $( 或 `；該段有未加引號的 $；cp 的 -l／-s（連結會讓之後的寫入改到原檔）；
# install -d（運算元全是要建立的目錄）；不認得、可能吃下一個詞的長選項；PowerShell 帶任何選項。
# Bash 裡未加引號的 \ 是跳脫字元；PowerShell 裡 \ 是路徑分隔，照字面算。
r5_sources() {
  json_field command | awk -v MODE="$1" -v OK="$2" -v HOME_DIR="${HOME:-}" -v PS="$([ "$TOOL" = PowerShell ] && echo 1)" '
function endword() {
  if (!inw) return
  K++; kind[K] = "w"; txt[K] = w; val[K] = v; wdang[K] = wd; rd[K] = pend
  pend = 0; w = ""; v = ""; inw = 0; wd = 0
}
function addtext(x) { K++; kind[K] = "s"; txt[K] = x }
function norm(p) {
  gsub(/\\/, "/", p)
  if (p == "~" || substr(p, 1, 2) == "~/") p = HOME_DIR substr(p, 2)
  return p
}
function endseg(   j, first, cmd, endopt, skip, sk, tgt, bad, no, x, name, L, p, ch, isrc, src, out) {
  endword()
  first = 0
  for (j = 1; j <= K; j++) if (kind[j] == "w" && !rd[j]) { first = j; break }
  if (first && !segdang && !anydang) {
    cmd = val[first]; sub(/.*\//, "", cmd)
    if (cmd == "cp" || cmd == "cat" || cmd == "install") {
      endopt = 0; skip = 0; tgt = 0; bad = 0; no = 0
      for (j = first + 1; j <= K; j++) {
        if (kind[j] != "w" || rd[j]) continue
        x = val[j]
        if (skip) { if (sk == "t") tgt = 1; skip = 0; continue }
        if (!endopt && x == "--") { endopt = 1; continue }
        if (!endopt && x ~ /^-./) {
          if (PS) bad = 1
          if (cmd == "cat") continue
          if (x ~ /^--/) {
            name = x; sub(/=.*/, "", name)
            if (name ~ /^--t/) { if (x ~ /=/) tgt = 1; else { skip = 1; sk = "t" } }
            else if (name ~ /^--(l|sy|d)/) bad = 1
            else if (x ~ /=/) ;
            else if (name !~ /^--(recursive|force|verbose|preserve|archive|no-clobber|interactive|update|parents|dereference|no-dereference|one-file-system|backup|remove-destination|strip-trailing-slashes|no-target-directory|compare|preserve-timestamps|attributes-only|debug|keep-directory-symlink|copy-contents|reflink)$/) bad = 1
            continue
          }
          L = length(x)
          for (p = 2; p <= L; p++) {
            ch = substr(x, p, 1)
            if (ch == "t") { if (p < L) tgt = 1; else { skip = 1; sk = "t" }; break }
            if (ch == "S" || (cmd == "install" && (ch == "m" || ch == "o" || ch == "g"))) { if (p == L) { skip = 1; sk = "a" }; break }
            if (cmd == "cp" && (ch == "l" || ch == "s")) bad = 1
            if (cmd == "install" && ch == "d") bad = 1
          }
          continue
        }
        op[++no] = j
      }
      if (!bad) {
        for (j = 1; j <= no; j++) {
          if (cmd != "cat" && !tgt && j == no) break
          isrc[op[j]] = 1
        }
        if (cmd == "cat") for (j = 1; j <= K; j++) if (kind[j] == "w" && rd[j] == 2) isrc[j] = 1
      }
    }
  }
  for (j = 1; j <= K; j++) {
    out = txt[j]
    if ((j in isrc) && !wdang[j] && val[j] !~ /[$`]/) {
      src = norm(val[j])
      if (MODE == "list") print src
      else if (src in okset) out = ""
    }
    if (MODE == "strip") printf "%s", out
  }
  K = 0; segdang = 0; pend = 0
  delete kind; delete txt; delete val; delete wdang; delete rd; delete op
}
BEGIN {
  SQ = "\047"; DQ = "\042"
  nok = split(OK, oka, "\n"); for (i = 1; i <= nok; i++) if (oka[i] != "") okset[oka[i]] = 1
}
{ s = s (NR > 1 ? " " : "") $0 }
END {
  t = ""; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\" && i < n) {
      d = substr(s, ++i, 1)
      if (d == "n" || d == "r") c = "\n"; else if (d == "t") c = "\t"; else c = d
    }
    t = t c
  }
  anydang = (t ~ /[$][(]/ || index(t, "`") > 0)
  n = length(t); q = 0; K = 0; pend = 0
  for (i = 1; i <= n; i++) {
    c = substr(t, i, 1)
    if (q == 1) { w = w c; if (c == SQ) q = 0; else v = v c; continue }
    if (q == 2) {
      if (c == "\\" && i < n && !PS) {
        d = substr(t, i + 1, 1); w = w c d; i++
        v = v (index("$`\"\\\n", d) ? "" : c) (d == "\n" ? "" : d)
        continue
      }
      if (c == DQ) { w = w c; q = 0; continue }
      if (c == "$") wd = 1
      w = w c; v = v c; continue
    }
    if (c == SQ) { q = 1; inw = 1; w = w c; continue }
    if (c == DQ) { q = 2; inw = 1; w = w c; continue }
    if (c == "\\" && i < n && !PS) {
      d = substr(t, i + 1, 1); w = w c d; if (d != "\n") v = v d
      i++; inw = 1; continue
    }
    if (c == " " || c == "\t") { endword(); addtext(c); continue }
    if (index(";&|()`\n", c)) { endseg(); if (MODE == "strip") printf "%s", c; continue }
    if (c == "<" || c == ">") {
      if (inw && w ~ /^[0-9]+$/) { addtext(w); w = ""; v = ""; inw = 0; wd = 0 }
      else endword()
      op_ = c
      while (i < n && index("<>", substr(t, i + 1, 1))) op_ = op_ substr(t, ++i, 1)
      addtext(op_)
      pend = (index(op_, ">") ? 1 : 2)
      continue
    }
    if (c == "$") { segdang = 1; wd = 1 }
    w = w c; v = v c; inw = 1
  }
  endseg()
}' | tr '\\' '/'
}

# cp／cat／install 的來源若確實在本 plugin 目錄裡（解開符號連結後仍在、沒有 ..），從指令裡拿掉；
# 只剩寫入目標與其他詞，交給 r5_bash 照舊檢查。印出的格式同 json_plain（多了真換行，切詞時一樣是分隔）。
r5_cmd_without_plugin_sources() {
  _root=$(src_root)
  _ok=
  if [ -n "$_root" ]; then
    for _s in $(r5_sources list ""); do
      case /$_s/ in */../* | */./*) continue ;; esac
      _r=$(real_path "$_s" | tr '\\' '/' | lower | sed 's/^[a-z]://')
      case $_r in "$_root"/*) _ok="$_ok$_s
" ;; esac
    done
  fi
  if [ -z "$_ok" ]; then
    json_field command | json_plain
    return
  fi
  r5_sources strip "$_ok"
}

# Bash 的 R5：防護層其他檔案一律擋；.claude 分級，專案內的讀取放行、改 commands／agents 先問。
# cp／cat／install 從本 plugin 目錄複製出來（例如 viewer.html 模板）只看寫入目標。
R5_PENDING_ASK=0
r5_bash() {
  _raw=$(r5_cmd_without_plugin_sources)
  _cd=0
  printf '%s' "$1" | grep -Eq '(^|[[:space:];&|(`])(cd|pushd|popd)([[:space:]]|$)' && _cd=1
  _proj=0
  _other=0
  for w in $(guard_tokens "$_raw"); do
    _lw=$(printf '%s' "$w" | lower)
    is_guard_path "$_lw" && hit deny R5 "擋下：想改防護設定" "$R5_REASON"
    case $_lw in
      .claude | .claude/* | */.claude | */.claude/* | .claude.json | */.claude.json) ;;
      *) continue ;;
    esac
    case $(claude_class "$w" "$_cd") in
      cmd) _proj=1 ;;
      proj) _proj=1 _other=1 ;;
      *) hit deny R5 "擋下：想改防護設定" "$R5_REASON" ;;
    esac
  done
  [ "$_proj" = 1 ] || return 0
  cmd_is_read "$1" && return 0
  [ "$_other" = 0 ] || hit deny R5 "擋下：想改專案的 .claude 設定" "$R5_REASON"
  R5_PENDING_ASK=1
}

# 在殼層再開一個 claude 並關掉防護，或把本外掛關掉、移除。
r5_claude_cli() {
  _p='(^|[[:space:];&|(`])claude'
  printf '%s' "$1" | grep -Eq "${_p}([[:space:]]+[^;&|]*)?[[:space:]](--settings|--dangerously-skip-permissions|--permission-mode|--print|-p)([[:space:]=]|\$)" && return 0
  printf '%s' "$1" | grep -Eq "${_p}[[:space:]]+plugins?[[:space:]]+(disable|uninstall|remove)" && return 0
  return 1
}

# 把路徑解到真正位置（符號連結都展開）。只處理絕對路徑；不存在的尾段原樣接回。
real_path() {
  _p=$1
  _n=0
  case $_p in /*) ;; *) printf '%s' "$_p"; return ;; esac
  while [ -L "$_p" ] && [ "$_n" -lt 8 ]; do
    _t=$(readlink "$_p") || break
    case $_t in /*) _p=$_t ;; *) _p="${_p%/*}/$_t" ;; esac
    _n=$((_n + 1))
  done
  _rest=
  while [ ! -d "$_p" ] && [ -n "$_p" ] && [ "$_p" != / ]; do
    _rest="/${_p##*/}$_rest"
    _p=${_p%/*}
  done
  _d=$(cd -P "${_p:-/}" 2>/dev/null && pwd -P) || _d=$_p
  printf '%s' "${_d%/}$_rest"
}

# 寫入工具：原路徑與解開符號連結後的路徑都要比對。專案內 .claude/commands、agents 改成先問。
r5_write_path() {
  _raw=$(json_field "$1" | json_plain)
  _real=$(real_path "$_raw")
  case $_raw in
    /*) [ "$(claude_class "$_raw" 0)" = cmd ] && ! is_guard_path "$(printf '%s' "$_real" | lower)" &&
      hit ask R5 "先問：想改專案的自訂指令或代理" "$R5_ASK_REASON" ;;
  esac
  r5_scan "$(printf '%s %s' "$_raw" "$_real" | lower)"
}

# 欄位值：還原跳脫（含 Windows 反斜線）後轉小寫。
field() { json_field "$1" | json_plain | lower; }


# ---- R7：不可逆、公開、帶憑證的對外動作（任何模式都擋，連「全部允許」模式也擋）----
R7_PUSH_REASON="這個專案要推上去的地方是公開的，或我確認不了它是私人的。綠洲不讓 AI 代替你公開推送（規則 R7）。想推的話請你自己動手：打開終端機，進到專案資料夾，輸入 git push。"
R7_VIS_REASON="這會公開你的專案，或改變專案的公開／私人設定，綠洲不讓 AI 做（規則 R7）。要改請你自己到 GitHub 網站上操作。"
R7_PUB_REASON="這會把套件發佈到公開的套件庫，發出去就收不回來，綠洲不讓 AI 做（規則 R7）。要發佈請你自己確認內容後手動執行。"
R7_PAY_REASON="這會動到付款，綠洲不讓 AI 花你的錢（規則 R7）。請你自己在付款頁面操作。"
R7_REMOTE_REASON="這會改掉專案的推送位址，或程式連線用的位址與代理設定，可能讓你的資料被送到別人那裡，綠洲不讓 AI 改（規則 R7）。要改請你自己動手。"
R7_TUNNEL_REASON="這會把你電腦上的服務開成外面也連得進來的網址，綠洲不讓 AI 做（規則 R7）。"
R7_CRED_REASON="這會把密碼、金鑰或存取權杖印出來或送出去，綠洲不讓 AI 做（規則 R7）。需要的話請你自己打開看。"

# 只是在「顯示、搜尋文字」的指令：裡面提到設定名稱不算改設定。
is_text_viewer() {
  case ${1%% *} in echo | printf | grep | egrep | fgrep | rg | cat | less | more | head | tail | man | type | which | where) return 0 ;; esac
  return 1
}

# git push 要推去哪：印出 github 的「擁有者/名稱」、local（本機路徑）或空字串（認不出來）。
push_target() {
  _dir=$(json_field cwd | json_plain)
  _rm=
  _prevw=
  _seen=0
  for _w in $(printf '%s' "$1" | tr ' ' '\n'); do
    _w=$(printf '%s' "$_w" | tr -d "\"'")
    if [ "$_prevw" = -C ] && [ "$_seen" = 0 ]; then _dir=$_w; fi
    if [ "$_prevw" = --repo ]; then _rm=$_w; fi
    case $_w in
      --repo=*) _rm=${_w#--repo=} ;;
      push) _seen=1 ;;
      -*) ;;
      *) [ "$_seen" = 1 ] && [ -z "$_rm" ] && [ "$_prevw" != -o ] && [ "$_prevw" != --push-option ] && _rm=$_w ;;
    esac
    _prevw=$_w
  done
  if [ -z "$_rm" ]; then
    _rm=$(git -C "${_dir:-.}" rev-parse --abbrev-ref '@{push}' 2>/dev/null)
    _rm=${_rm%%/*}
    _rm=${_rm:-origin}
  fi
  case $_rm in
    *://* | *@*:* | /* | ./* | ../* | '~'*) _url=$_rm ;;
    *) _url=$(git -C "${_dir:-.}" remote get-url --push "$_rm" 2>/dev/null) ;;
  esac
  case $_url in
    file://* | /* | ./* | ../* | '~'*) echo local; return ;;
  esac
  printf '%s' "$_url" | sed -nE 's#^.*github\.com[:/]+([^/[:space:]]+)/([^/[:space:]]+)$#\1/\2#p' | sed -E 's/\.git$//; s/[?#].*$//'
}

# 這個 github repo 查得到而且確定是私人的才算私人；離線、沒登入、沒有 gh、查不到，一律當公開。
repo_is_private() {
  command -v gh >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then
    _pv=$(timeout 6 gh api "repos/$1" --jq .private 2>/dev/null)
  else
    _pv=$(gh api "repos/$1" --jq .private 2>/dev/null)
  fi
  [ "$_pv" = true ]
}

r6_push() {
  _t=$(push_target "$1")
  [ "$_t" = local ] && return 0
  [ -n "$_t" ] && repo_is_private "$_t" && return 0
  hit deny R7 "擋下：想推送到公開的（或確認不了是私人的）repo" "$R7_PUSH_REASON"
}

# $1=小寫的一段指令，$2=原樣的一段指令
r6_segment() {
  _sh=$(seg_head "$1")
  _first=${_sh%%[[:space:]]*}
  _sg=" $_sh "
  case $_first in
    ngrok | cloudflared | localtunnel | loca.lt | bore | zrok | frpc | loophole | telebit | devtunnel | pinggy | tunnelmole | tmole | serveo | localhost.run)
      hit deny R7 "擋下：想開對外的連線通道" "$R7_TUNNEL_REASON" ;;
    lt) printf '%s' "$_sg" | grep -Eq '[[:space:]](--port|-p)[[:space:]]' && hit deny R7 "擋下：想開對外的連線通道" "$R7_TUNNEL_REASON" ;;
    tailscale) printf '%s' "$_sg" | grep -Eq '[[:space:]]funnel[[:space:]]' && hit deny R7 "擋下：想開對外的連線通道" "$R7_TUNNEL_REASON" ;;
    ssh) printf '%s' "$_sg" | grep -Eq '[[:space:]]-[a-z0-9]*r[a-z0-9]*[[:space:]]?[0-9:*a-z.]' && hit deny R7 "擋下：想開對外的連線通道" "$R7_TUNNEL_REASON" ;;
    code) printf '%s' "$_sg" | grep -Eq '[[:space:]]tunnel[[:space:]]' && hit deny R7 "擋下：想開對外的連線通道" "$R7_TUNNEL_REASON" ;;
    gh) printf '%s' "$_sg" | grep -Eq '[[:space:]]codespace[[:space:]]+ports[[:space:]]+visibility' && hit deny R7 "擋下：想開對外的連線通道" "$R7_TUNNEL_REASON" ;;
  esac
  case $_first in
    echo | printf)
      printf '%s' "$_sg" | grep -Eq '[$]\{?[a-z_]*(token|secret|api_?key|password|passwd|credential|private_key)' &&
        hit deny R7 "擋下：想把密碼或金鑰印出來" "$R7_CRED_REASON" ;;
  esac
  is_text_viewer "$_first" && return 0
  case $_first in
    npm | pnpm | yarn | bun)
      printf '%s' "$_sg" | grep -Eq "[[:space:]]publish[[:space:]]" && ! printf '%s' "$_sg" | grep -Eq '[[:space:]]--dry-run([[:space:]]|$)' &&
        hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
    cargo | gem | poetry | uv | flit | hatch | vsce | ovsx)
      printf '%s' "$_sg" | grep -Eq "[[:space:]](publish|push)[[:space:]]" && ! printf '%s' "$_sg" | grep -Eq '[[:space:]]--dry-run([[:space:]]|$)' &&
        hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
    twine | pip | pip3) printf '%s' "$_sg" | grep -Eq "[[:space:]]upload[[:space:]]" && hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
    python*)
      printf '%s' "$_sg" | grep -Eq '[[:space:]]-m[[:space:]]+(twine[[:space:]]+upload|build[[:space:]]+--upload)' && hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
    docker | podman) printf '%s' "$_sg" | grep -Eq "[[:space:]]push[[:space:]]" && hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
    dotnet) printf '%s' "$_sg" | grep -Eq "[[:space:]]nuget[[:space:]]+push[[:space:]]" && hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
    mvn) printf '%s' "$_sg" | grep -Eq "[[:space:]]deploy[[:space:]]" && hit deny R7 "擋下：想發佈套件" "$R7_PUB_REASON" ;;
  esac
  case $_first in
    stripe) printf '%s' "$_sg" | grep -Eq "[[:space:]](create|confirm|capture|--live)[[:space:]]" && hit deny R7 "擋下：想動到付款" "$R7_PAY_REASON" ;;
    curl | wget | http | https | xh)
      printf '%s' "$_sg" | grep -Eq '(api\.stripe\.com|api(-m)?\.(sandbox\.)?paypal\.com|api\.paddle\.com|api\.lemonsqueezy\.com|api\.mollie\.com|api\.squareup\.com)' &&
        hit deny R7 "擋下：想動到付款" "$R7_PAY_REASON"
      printf '%s' "$_sg" | grep -Eq '(--data|--json|-d|--form|-F|-X[[:space:]]*(post|put|patch))' &&
        printf '%s' "$_sg" | grep -Eq '[$]\{?[a-z_]*(token|secret|api_?key|password|passwd|credential)' &&
        hit deny R7 "擋下：想把密碼或金鑰送出去" "$R7_CRED_REASON" ;;
  esac
  case $_first in
    printenv)
      printf '%s' "$_sg" | grep -Eq '[[:space:]][a-z_]*(token|secret|api_?key|password|passwd|credential|private_key)' &&
        hit deny R7 "擋下：想把密碼或金鑰印出來" "$R7_CRED_REASON" ;;
    gh)
      printf '%s' "$_sg" | grep -Eq '[[:space:]]auth[[:space:]]+token([[:space:]]|$)|[[:space:]]auth[[:space:]]+(status|login|refresh)[[:space:]].*(-t|--show-token)([[:space:]]|$)' &&
        hit deny R7 "擋下：想把密碼或金鑰印出來" "$R7_CRED_REASON"
      printf '%s' "$_sg" | grep -Eq '[[:space:]]repo[[:space:]]+edit[[:space:]]' && printf '%s' "$_sg" | grep -Eq -e '--visibility' &&
        hit deny R7 "擋下：想改專案的公開／私人設定" "$R7_VIS_REASON"
      printf '%s' "$_sg" | grep -Eq '[[:space:]]repo[[:space:]]+create[[:space:]]' && printf '%s' "$_sg" | grep -Eq -e '--public' &&
        hit deny R7 "擋下：想建立公開的專案" "$R7_VIS_REASON"
      printf '%s' "$_sg" | grep -Eq '[[:space:]]api[[:space:]]' && printf '%s' "$_sg" | grep -Eq '(private|visibility)[[:space:]]*=' &&
        hit deny R7 "擋下：想改專案的公開／私人設定" "$R7_VIS_REASON" ;;
    git)
      case $_sg in
        *"credential fill"* | *"credential-"*) hit deny R7 "擋下：想把密碼或金鑰印出來" "$R7_CRED_REASON" ;;
      esac
      printf '%s' "$_sg" | grep -Eq '[[:space:]]remote[[:space:]]+(add|set-url|remove|rm|rename)[[:space:]]' &&
        hit deny R7 "擋下：想改專案的推送位址" "$R7_REMOTE_REASON"
      if printf '%s' "$_sg" | grep -Eq '[[:space:]]config[[:space:]]' &&
        printf '%s' "$_sg" | grep -Eq '(remote\.[^[:space:]]*\.(url|pushurl)|url\.[^[:space:]]*\.(insteadof|pushinsteadof)|(https?)\.proxy|core\.gitproxy)' &&
        ! printf '%s' "$_sg" | grep -Eq '[[:space:]](--get|--get-all|--get-regexp|-l|--list)[[:space:]]'; then
        hit deny R7 "擋下：想改專案的推送位址" "$R7_REMOTE_REASON"
      fi
      printf '%s' "$_sg" | grep -Eq '[[:space:]]push([[:space:]]|$)' && r6_push "$2" ;;
  esac
  case $_first in
    npm | pnpm | yarn | pip | pip3 | bun)
      printf '%s' "$_sg" | grep -Eq '[[:space:]](config[[:space:]]+)?set[[:space:]]+[a-z.-]*proxy' &&
        hit deny R7 "擋下：想改代理設定" "$R7_REMOTE_REASON" ;;
  esac
  printf ' %s ' "$1" | grep -Eq '(^|[^a-z0-9_])(anthropic_base_url|(https?|all|ftp)_proxy)["'"'"']?[[:space:]]*[=,]' &&
    hit deny R7 "擋下：想改連線位址或代理設定" "$R7_REMOTE_REASON"
  return 0
}

r6_bash() {
  _raw=$(json_field command | json_plain)
  _lows=$(printf '%s' "$_raw" | lower)
  _lines=$(cmd_segments "$_lows")
  _rlines=$(cmd_segments "$_raw")
  _total=$(printf '%s\n' "$_lines" | wc -l)
  _ln=1
  while [ "$_ln" -le "$_total" ]; do
    r6_segment "$(printf '%s\n' "$_lines" | sed -n "${_ln}p")" "$(printf '%s\n' "$_rlines" | sed -n "${_ln}p")"
    _ln=$((_ln + 1))
  done
}

# 寫進 shell 設定檔或 .git/config 的連線位址、代理設定。
r6_write() {
  _f=$(field "$1")
  case $_f in */.git/config | .git/config) hit deny R7 "擋下：想改專案的推送位址" "$R7_REMOTE_REASON" ;; esac
  case ${_f##*/} in .bashrc | .zshrc | .profile | .zprofile | .bash_profile | .npmrc | .gitconfig | settings*.json | *.ps1 | .env.local) ;; *) return 0 ;; esac
  printf '%s' "$INPUT" | lower | grep -Eq '(anthropic_base_url|(https?|all|ftp)_proxy)[^a-z0-9_]' && hit deny R7 "擋下：想改連線位址或代理設定" "$R7_REMOTE_REASON"
}

case $TOOL in
  Read) r1_scan "$(field file_path)" 1 ;;
  Grep) r1_scan "$(field path) $(field glob)" 0; home_scope_scan "$(field path)" ;;
  Glob) r1_scan "$(field path) $(field pattern)" 0; home_scope_scan "$(field path)" ;;
  Bash | PowerShell | Monitor)
    CMD=$(field command)
    r1_scan "$CMD" 0
    leaks_secrets "$CMD" && hit deny R1 "擋下：想讀環境變數或鑰匙圈" "$R1_REASON"
    r6_bash
    r5_bash "$CMD"
    r5_claude_cli "$CMD" && hit deny R5 "擋下：想關掉或繞過防護" "$R5_REASON"
    [ "$R5_PENDING_ASK" = 1 ] && hit ask R5 "先問：想改專案的自訂指令或代理" "$R5_ASK_REASON"
    ;;
  LSP) r1_scan "$(printf '%s' "$INPUT" | sed 's/.*"tool_input" *://' | json_plain | lower)" 0 ;;
  Write | Edit | MultiEdit) r6_write file_path; r5_write_path file_path ;;
  mcp__*)
    case $(mcp_name) in
      _get_* | _list_* | _read_* | _search_* | _fetch_* | _find_* | _view_* | _query_*) ;;
      *_pay_* | *_payment_* | *_payments_* | *_purchase_* | *_checkout_* | *_charge_* | *_payout_* | *_refund_*) hit deny R7 "擋下：想動到付款" "$R7_PAY_REASON" ;;
    esac
    ;;
  NotebookEdit) r5_write_path notebook_path ;;
esac
exit 0
