#!/bin/sh
# 守衛共用函式（POSIX sh；只用 grep、sed、tr、date 等基本工具，不依賴 bun/node/jq/python）。
# 由 hard.sh、soft.sh、post.sh 用 `.` 引入。
LC_ALL=C
export LC_ALL

# 讀 stdin（hook 的 JSON）。換行換成空白，方便用 grep 處理。
guard_load() {
  INPUT=$(cat | tr '\n\r' '  ')
}

# 取第一個字串欄位的值（原樣，含跳脫字元）。指令裡的引號都被跳脫成 \"，所以偽造不了欄位。
json_field() {
  printf '%s' "$INPUT" | grep -oE "\"$1\" *: *\"([^\"\\\\]|\\\\.)*\"" | head -n 1 | sed 's/^[^:]*: *"//; s/"$//'
}

# 把 JSON 跳脫還原成空白，再切成「一行一個詞」：空白、引號、; | & < > ( ) { } , = : \ 都是分隔。
guard_tokens() {
# shellcheck disable=SC1003
  printf '%s' "$1" | sed 's/\\[ntr]/ /g; s/\\"/ /g' | tr -s ' \t"'"'"'`;|&<>(){},=:\\' '\n'
}

# 有事就印一行「種類<TAB>規則<TAB>摘要<TAB>白話理由」然後結束；沒事什麼都不印。
hit() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"
  exit 0
}

# 指令會不會「寫入或改動東西」：有導向、或用了會改檔的指令。純讀取（cat、grep、ls）不算。
cmd_writes() {
  _c=$(printf '%s' "$1" | sed 's/[0-9]*>&[0-9-]*//g; s/[0-9]*> *\/dev\/null//g')
  case $_c in *'>'*) return 0 ;; esac
  printf '%s' "$_c" | grep -Eq '(^|[[:space:];&|(`])(tee|mv|cp|rm|ln|chmod|chown|truncate|dd|install|patch|python3?|node|bun|deno|perl|ruby|unzip|tar|rsync|wget|curl|mkdir|touch|npm|npx|bunx|pip3?|uv)([[:space:]]|$)' && return 0
  printf '%s' "$_c" | grep -Eq '(^|[[:space:];&|(`])sed[[:space:]]+(-[A-Za-z]*i|--in-place)' && return 0
  printf '%s' "$_c" | grep -Eq '(^|[[:space:];&|(`])git[[:space:]]+(clone|submodule|checkout|restore|apply|mv|rm|pull|merge|reset)' && return 0
  return 1
}

# 外部內容旗標：以 session_id 為鍵。優先放 CLAUDE_PLUGIN_DATA，寫不進去就退到暫存目錄。
guard_sid() {
  _s=$(json_field session_id | tr -d '\n' | tr -c 'A-Za-z0-9_-' '_')
  printf '%s' "${_s:-nosession}"
}

flag_dirs() {
  [ -n "${CLAUDE_PLUGIN_DATA:-}" ] && printf '%s\n' "$CLAUDE_PLUGIN_DATA/oasis-guard"
  printf '%s\n' "${TMPDIR:-/tmp}/oasis-guard"
}

flag_set() {
  _sid=$(guard_sid)
  for _d in $(flag_dirs); do
    mkdir -p "$_d" 2>/dev/null && : >"$_d/ext-$_sid" 2>/dev/null && return 0
  done
  return 1
}

# 「找不到旗標」不等於「沒讀過外部內容」：主要狀態目錄不存在、不是可讀寫的目錄，或旗標檔在但讀不到
# （例如懸空連結），一律當成讀過。目錄不存在時順手建起來，下一次就能照常判斷。
flag_has() {
  _sid=$(guard_sid)
  _main=$(flag_dirs | head -n 1)
  if [ ! -e "$_main" ] && [ ! -L "$_main" ]; then
    mkdir -p "$_main" 2>/dev/null
    return 0
  fi
  [ -d "$_main" ] && [ -r "$_main" ] && [ -w "$_main" ] && [ -x "$_main" ] || return 0
  for _d in $(flag_dirs); do
    [ -e "$_d/ext-$_sid" ] || [ -L "$_d/ext-$_sid" ] && return 0
  done
  return 1
}

# 工具名稱認不出來：空字串、缺欄位，或和已知工具只差大小寫（例如 bash、MCP__x）。
# 已知工具以外、拼法正確的名稱不算（交給各規則照常判斷）。
tool_unrecognized() {
  _t=$(printf '%s' "$1" | tr -d ' \t')
  [ -n "$_t" ] || return 0
  case $1 in
    Read | Grep | Glob | Bash | PowerShell | Monitor | Write | Edit | MultiEdit | NotebookEdit | LSP | WebFetch | WebSearch | mcp__*) return 1 ;;
  esac
  case $(printf '%s' "$_t" | lower) in
    read | grep | glob | bash | powershell | monitor | write | edit | multiedit | notebookedit | lsp | webfetch | websearch | mcp__*) return 0 ;;
  esac
  return 1
}
TOOL_REASON="無法辨識工具名稱，為了安全"

# JSON 跳脫還原成純文字：\\（Windows 路徑的反斜線）變 /，\n 變空白，\" 變 "。
# 先處理 \\ 再處理 \n，所以 C:\\new 不會被當成換行。
json_plain() {
  sed 's/\\\\/\//g; s/\\[ntr]/ /g; s/\\"/"/g'
}

# 全部轉小寫（macOS、Windows 路徑不分大小寫，比對前先統一）。
lower() {
  tr '[:upper:]' '[:lower:]'
}

# 這個詞是不是「家目錄或更上層」（~、$HOME、/、/home、/home/<人>、/users/<人>、C:\\Users\\<人>）。
# 傳進來的詞要先轉小寫、反斜線換成 /。
is_home_or_above() {
  _t=${1%/}
  case $_t in [a-z]:*) _t=${_t#?:} ;; esac
  _t=${_t%/}
  case $_t in
    "" | '~' | '$home' | '$userprofile' | '%userprofile%' | /home | /users | /root | /c | /c/users) return 0 ;;
  esac
  _hm=$(printf '%s' "${HOME:-}" | tr 'A-Z\\' 'a-z/')
  _hm=${_hm%/}
  if [ -n "$_hm" ]; then
    [ "$_t" = "$_hm" ] && return 0
    case $_hm in "$_t"/*) return 0 ;; esac
  fi
  for _pre in /home/ /users/ /c/users/; do
    case $_t in
      "$_pre"*)
        _r=${_t#"$_pre"}
        case $_r in */*) ;; *) return 0 ;; esac
        ;;
    esac
  done
  return 1
}

# 指令「實際會執行的部分」：先還原 JSON 跳脫，再去掉 git commit 的 -m 訊息與註解（# 行尾註解、行首 //），
# 讓訊息或註解裡的網址不會被當成外送。引號、heredoc 都照殼層規則走；訊息裡有 $ 或 ` 會被執行，就不去掉。
# 輸入是 json_field 取出的原始字串，輸出單行（換行變空白、反斜線變 /，和 json_plain 一致）。
cmd_clean() {
  printf '%s\n' "$1" | awk '
function flush(  drop, v) {
  if (!inw) return
  drop = 0
  if (skip) { skip = 0; if (!dang) drop = 1 }
  else if (gitsub == "commit" && (uv ~ /^--message=/ || uv ~ /^-m./) && uv !~ /^-[a-zA-Z]*m$/) { if (!dang) drop = 1 }
  o = o (drop ? SQ SQ : w)
  if (!drop) {
    cw++
    if (cw == 1) { f = uv; sub(/.*\//, "", f) }
    else if (f == "git" && gitsub == "") {
      if (optarg) optarg = 0
      else if (uv == "-C" || uv == "-c") optarg = 1
      else if (uv !~ /^-/) gitsub = uv
    } else if (gitsub == "commit") {
      if (uv == "-m" || uv == "--message" || uv ~ /^-[a-zA-Z]*m$/) skip = 1
    }
  }
  w = ""; uv = ""; inw = 0; dang = 0
}
function newcmd() { flush(); cw = 0; f = ""; gitsub = ""; optarg = 0; skip = 0 }
# 從 t 的第 p 個字元開始找 heredoc 結尾（單獨一行的 dl）；回傳結尾那行之後的位置，找不到回傳 0。
function hd_end(p, dl, tabs,   e, line) {
  while (p <= n) {
    e = index(substr(t, p), "\n")
    line = e ? substr(t, p, e - 1) : substr(t, p)
    if (tabs) sub(/^\t+/, "", line)
    if (line == dl) return e ? p + e : n + 1
    if (!e) return 0
    p += e
  }
  return 0
}
BEGIN { SQ = "\047"; DQ = "\042" }
{ s = s (NR > 1 ? " " : "") $0 }
END {
  t = ""; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\" && i < n) {
      d = substr(s, ++i, 1)
      if (d == "n") c = "\n"; else if (d == "t") c = "\t"; else if (d == "r") c = " "; else c = d
    }
    t = t c
  }
  n = length(t); q = 0; atline = 1; np = 0
  for (i = 1; i <= n; i++) {
    c = substr(t, i, 1)
    if (q == 1) { w = w c; if (c == SQ) q = 0; else uv = uv c; continue }
    if (q == 2) {
      if (c == "\\") { w = w c substr(t, i + 1, 1); uv = uv substr(t, i + 1, 1); i++; continue }
      if (c == DQ) { w = w c; q = 0; continue }
      if (c == "`") { dang = 1; w = w c; continue }
      if (c == "$") {
        r = substr(t, i)
        if (match(r, "^[$][(][ \t]*cat[ \t]+<<-?[ \t]*[" SQ DQ "]?[A-Za-z_][A-Za-z0-9_]*[" SQ DQ "]?[ \t]*\n")) {
          hd = substr(r, 1, RLENGTH); quoted = (hd ~ "[" SQ DQ "]")
          dl = hd; sub(/^[$][(][ \t]*cat[ \t]+<</, "", dl); tabs = (dl ~ /^-/)
          sub(/^-/, "", dl); gsub("[" SQ DQ " \t\n]", "", dl)
          e = hd_end(i + RLENGTH, dl, tabs)
          if (e) {
            rest = substr(t, e)
            if (match(rest, /^[ \t\n]*[)]/)) {
              body = substr(t, i + RLENGTH, e - i - RLENGTH)
              if (!quoted && body ~ /[$`]/) dang = 1
              w = w substr(t, i, e + RLENGTH - i); i = e + RLENGTH - 1
              continue
            }
          }
        }
        dang = 1
      }
      w = w c; uv = uv c; continue
    }
    if (c == SQ) { q = 1; inw = 1; atline = 0; w = w c; continue }
    if (c == DQ) { q = 2; inw = 1; atline = 0; w = w c; continue }
    if (c == "\\") { w = w c substr(t, i + 1, 1); uv = uv substr(t, i + 1, 1); i++; inw = 1; atline = 0; continue }
    if (!inw && (c == "#" || (atline && substr(t, i, 2) == "//"))) {
      e = index(substr(t, i), "\n")
      if (!e) break
      i += e - 2; continue
    }
    if (c == " " || c == "\t") { flush(); o = o " "; continue }
    if (c == "\n") {
      newcmd(); o = o " "; atline = 1
      for (k = 1; k <= np; k++) {
        e = hd_end(i + 1, pd[k], pt[k])
        if (!e) e = n + 1
        b = substr(t, i + 1, e - i - 1)
        while (b != "") {
          x = index(b, "\n"); line = x ? substr(b, 1, x - 1) : b
          b = x ? substr(b, x + 1) : ""
          if (line !~ /^[ \t]*(#|\/\/)/) o = o line " "
        }
        i = e - 1
      }
      np = 0
      continue
    }
    if (c == "<" && substr(t, i, 2) == "<<" && substr(t, i, 3) != "<<<") {
      r = substr(t, i)
      if (match(r, "^<<-?[ \t]*[" SQ DQ "]?[A-Za-z0-9_.-]+[" SQ DQ "]?")) {
        flush()
        hd = substr(r, 1, RLENGTH); dl = hd; sub(/^<</, "", dl)
        np++; pt[np] = (dl ~ /^-/); sub(/^-/, "", dl); gsub("[" SQ DQ " \t]", "", dl); pd[np] = dl
        o = o hd; i += RLENGTH - 1; atline = 0
        continue
      }
    }
    if (index(";&|()", c)) { newcmd(); o = o c; atline = 0; continue }
    if (c == "<" || c == ">") { flush(); o = o c; atline = 0; continue }
    if (c == "$" || c == "`") dang = 1
    w = w c; uv = uv c; inw = 1; atline = 0
  }
  flush()
  printf "%s", o
}' | tr '\n\r\t' '   ' | sed 's/\\/\//g'
}

# 本機位址不算外送。
is_local_host() {
  case $1 in
    localhost | ::1 | '[::1]') return 0 ;;
    127.*.*.*) case $1 in *[!0-9.]*) return 1 ;; esac; return 0 ;;
  esac
  return 1
}

# 網址的主機名：去掉 scheme、帳密、埠號與路徑，轉小寫。
url_host() {
  _u=$(printf '%s' "$1" | lower)
  _u=${_u#*://}
  _u=${_u%%[/?#]*}
  _u=${_u##*@}
  case $_u in
    \[*) _u="${_u%%]*}]" ;;
    *) _u=${_u%%:*} ;;
  esac
  printf '%s\n' "${_u%.}"
}

# 指令裡看得到的目的地（一行一個）：網址的主機、像網域的詞、IPv4、localhost、 ::1。
cmd_hosts() {
  _l=$(printf ' %s ' "$1" | lower)
  for _x in $(printf '%s' "$_l" | grep -oE '[a-z][a-z0-9+.-]*://[^/?#[:space:]"'"'"'<>|;&()`]*'); do
    url_host "$_x"
  done
  printf '%s' "$_l" | grep -oE '[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|dev|app|xyz|info|co|me|ai|cc|tk|ml|ga|cf|gq|top|site|online|cn|tw|jp|us|uk|de|ru|example|test|local|internal)([^a-z0-9.-]|$)' | sed 's/[^a-z0-9]$//'
  printf '%s' "$_l" | grep -oE '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}([^0-9]|$)' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}'
  printf '%s' "$_l" | grep -oE '(^|[^a-z0-9.-])localhost([^a-z0-9.-]|$)' | sed 's/.*/localhost/'
  printf '%s' "$_l" | grep -qE '(^|[^0-9a-z:])(\[::1\]|::1)([^0-9a-z:]|$)' && printf '::1\n'
  return 0
}

# 有沒有長亂碼（≥24 字元、像 base64 或 hex 的片段）：資料被編碼後夾帶出去的樣子。
has_random() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9+=_-' '\n' | grep -E '^.{24,}$' | grep -Eq '^[0-9A-Fa-f]+$|[0-9].*[A-Za-z]|[A-Za-z].*[0-9]'
}

# 同一 session 已被允許的網域：和外部內容旗標放同一處，一行一個。
dom_has() {
  _sid=$(guard_sid)
  for _d in $(flag_dirs); do
    [ -f "$_d/dom-$_sid" ] && grep -Fxq -e "$1" "$_d/dom-$_sid" && return 0
  done
  return 1
}

dom_add() {
  case $1 in "" | *[!a-z0-9.:\[\]-]*) return 1 ;; esac
  is_local_host "$1" && return 0
  dom_has "$1" && return 0
  _sid=$(guard_sid)
  for _d in $(flag_dirs); do
    mkdir -p "$_d" 2>/dev/null && printf '%s\n' "$1" >>"$_d/dom-$_sid" 2>/dev/null && return 0
  done
  return 1
}
# MCP 工具名稱：camelCase 拆開、轉小寫、非英數變底線，只看最後一段（__ 後面）。
mcp_name() {
  _n=${TOOL##*__}
  printf '_%s_' "$_n" | sed 's/\([a-z0-9]\)\([A-Z]\)/\1_\2/g' | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '_'
}


# 無人值守：沒有人能回答「要不要允許」。官方 hook 輸入沒有 -p／排程的欄位，只有 permission_mode；
# dontAsk 模式會自動拒絕沒預先核准的動作，等於沒人在場。其他情況（排程、-p）由啟動的人設 OASIS_UNATTENDED=1。
unattended() {
  [ "${OASIS_UNATTENDED:-}" = 1 ] && return 0
  [ "$(json_field permission_mode)" = dontAsk ] && return 0
  return 1
}

# 把指令切成「一行一段」：; & | ( ) ` 與換行是分隔，但引號裡的不算（echo "a; b" 是一段）。
# 引號內的分隔字元換成空白，引號本身保留。
cmd_segments() {
  printf '%s\n' "$1" | awk '
BEGIN { SQ = "\047"; DQ = "\042" }
{ s = s (NR > 1 ? " " : "") $0 }
END {
  q = ""; n = length(s); o = ""
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\" && q != SQ && i < n) { o = o c substr(s, i + 1, 1); i++; continue }
    if (q != "") {
      if (c == q) q = ""
      else if (index(";&|()`", c)) c = " "
      o = o c; continue
    }
    if (c == SQ || c == DQ) { q = c; o = o c; continue }
    if (index(";&|()`", c)) { o = o "\n"; continue }
    o = o c
  }
  print o
}'
}

# 去掉一段指令前面的包裝（sudo、env、VAR=值、npx、bash -c、引號…），讓第一個詞是真正要跑的程式。
# 程式前面的路徑與 .exe 也去掉。
seg_head() {
  _h=$(printf '%s' "$1" | sed -E 's/^[[:space:]]+//')
  _i=0
  while [ "$_i" -lt 8 ]; do
    _n=$(printf '%s' "$_h" | sed -E "s/^[[:space:]]*(([\"'{]|[a-zA-Z_][a-zA-Z0-9_]*=[^[:space:]]*|sudo|command|nohup|time|exec|setsid|env|npx|bunx|uvx|pnpx|(pnpm|yarn|bun)[[:space:]]+(dlx|x)|pipx[[:space:]]+run|timeout[[:space:]]+[0-9a-z.]+|-y|--yes|(ba|z|da)?sh[[:space:]]+-c)[[:space:]]+|[\"'{])//")
    [ "$_n" = "$_h" ] && break
    _h=$(printf '%s' "$_n" | sed -E 's/^[[:space:]]+//')
    _i=$((_i + 1))
  done
  printf '%s' "$_h" | sed -E 's#^[^[:space:]]*/##; s/^([^[:space:]]*)\.exe([[:space:]]|$)/\1\2/'
}
