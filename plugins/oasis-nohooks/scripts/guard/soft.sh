#!/bin/sh
# 軟規則：R2 對外動作先問、R3 讀過外部內容後外送要問、R4 裝技能先問。有事印一行 ask。
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
guard_load
TOOL=$(json_field tool_name)
tool_unrecognized "$TOOL" && hit ask R2/R3/R4 "先問：無法辨識工具名稱" "${TOOL_REASON}請你先確認這個動作（規則 R2/R3/R4）。"
set -f
IFS='
'

S='(^|[[:space:];&|(`])'
R2_REASON="這會把東西送出去、公開或刪掉，要你同意才做（規則 R2）。"
R3_REASON="這段對話讀過外部內容，為了防止裡面藏的指令把你的資料送出去，先問你（規則 R3）。"
R4_REASON="這會把技能或外掛放進你的環境，請先確認來源可信（規則 R4）。"
R4_PKG_REASON="這會在你的電腦上安裝新的程式套件，請先確認你需要它、來源可信（規則 R4）。"
R3_DENY_REASON="這段對話讀過外部內容，現在又沒有人在電腦前能確認，為了防止裡面藏的指令把你的資料送出去，直接擋下（規則 R3）。"
R3_SUMMARY="先問：讀過外部內容後想把資料送出"
R3_SEARCH_SUMMARY="先問：讀過外部內容後，搜尋字串夾帶長亂碼"

# R3 命中：有人在場就問；無人值守（排程、自動跑、沒人能回答）就直接擋下。
r3_hit() {
  if unattended; then
    hit deny R3 "擋下：無人在場，讀過外部內容後想把資料送出" "$R3_DENY_REASON"
  fi
  hit ask R3 "$1" "$R3_REASON"
}

has() { printf '%s' "$CMD" | grep -Eq -e "$1"; }
hasi() { printf '%s' "$CMD" | grep -Eiq -e "$1"; }

# curl/wget 帶資料、上傳、或用寫入型方法
http_send() {
  if has "${S}curl([[:space:]]|\$)"; then
    has '[[:space:]](--data[a-z-]*|--form[a-z-]*|--upload-file|--json)([[:space:]=]|$)' && return 0
    has '[[:space:]]-[A-Za-z]*[dFT]([[:space:]=@]|$)' && return 0
    hasi '[[:space:]](-X[[:space:]]*|--request[[:space:]=]+)(POST|PUT|PATCH|DELETE)' && return 0
  fi
  if has "${S}wget([[:space:]]|\$)"; then
    hasi '--(post-data|post-file|body-data|body-file|method[ =](POST|PUT|PATCH|DELETE))' && return 0
  fi
  return 1
}

# 其他會把資料送出本機的指令（只有 R3 用）
other_send() {
  has "${S}(scp|sftp|ftp|nc|ncat|netcat|socat|telnet|ssh|rsync|mail|mailx|sendmail|mutt|msmtp)([[:space:]]|\$)" && return 0
  has '/dev/(tcp|udp)/' && return 0
  return 1
}

R1_ASK_REASON="這個指令會翻遍或打包整個家目錄，裡面可能有金鑰和密碼，先問你（規則 R1）。"

# 遞迴搜尋、打包、複製整個家目錄（或更上層）：機密清單攔不到，改成先問。
sweeps_home() {
  _l=$(printf '%s' "$CMD" | lower)
  _hit=0
  printf '%s' "$_l" | grep -Eq "${S}(rg|ag|ack|find|fd|tar|zip|7z|7za|rsync|tree)([[:space:]]|\$)" && _hit=1
  printf '%s' "$_l" | grep -Eq "${S}(grep|egrep|fgrep|cp|scp)([[:space:]]|\$)" &&
    printf '%s' "$_l" | grep -Eq '[[:space:]](-[a-z]*r[a-z]*|--recursive)([[:space:]]|$)' && _hit=1
  [ "$_hit" = 1 ] || return 1
  for _w in $(guard_tokens "$_l"); do
    is_home_or_above "$_w" && return 0
  done
  return 1
}

# 有外部內容旗標時，這些都可能是把資料帶出去的管道：網址／主機名、腳本語言連網、DNS 工具、開瀏覽器、git 抓遠端。
net_call() {
  hasi '(https?|ftp|sftp|wss?)://' && return 0
  hasi '[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|dev|app|xyz|info|co|me|ai|cc|tk|ml|ga|cf|gq|top|site|online|cn|tw|jp|us|uk|de|ru|example|test|local|internal)([^a-z0-9]|$)' && return 0
  hasi '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}([^0-9]|$)' && return 0
  if has "${S}(python3?|node|bun|deno|perl|ruby|php)([[:space:]]|\$)"; then
    hasi '(urllib|urlopen|requests|httpx|http\.client|socket|fetch|axios|XMLHttpRequest|net/http|open-uri|LWP|curl|wget)' && return 0
  fi
  hasi "${S}(dig|nslookup|host|drill|resolvectl|whois|ping|traceroute|tracert|nping|curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|start-process)([[:space:]]|\$)" && return 0
  hasi "${S}(open|xdg-open|start|gio|wslview|sensible-browser|explorer(\.exe)?)([[:space:]]|\$)" && return 0
  hasi "${S}git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(clone|fetch|pull|ls-remote)([[:space:]]|\$)" && return 0
  return 1
}

# 連網目的地是不是都「看得到、而且安全」：只有本機，或都是這個 session 已允許過的網域（網址裡沒有長亂碼）。
# 有 $ 或 `（執行時才知道內容）、curl -K／wget -i（目的地寫在檔案裡）、看不到目的地，一律不算。
r3_dest_ok() {
  has '[$`]' && return 1
  has "${S}curl([[:space:]]|\$)" && has '[[:space:]](-K|--config)([[:space:]=]|$)' && return 1
  has "${S}wget([[:space:]]|\$)" && has '[[:space:]](-i|--input-file)([[:space:]=]|$)' && return 1
  _hs=$(cmd_hosts "$CMD")
  [ -n "$_hs" ] || return 1
  _ext=0
  for _h in $_hs; do
    is_local_host "$_h" && continue
    dom_has "$_h" || return 1
    _ext=1
  done
  if [ "$_ext" = 1 ]; then
    for _u in $(printf '%s' "$CMD" | grep -oE '[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]"'"'"'<>|;&()`]*'); do
      has_random "${_u#*://}" && return 1
    done
  fi
  return 0
}

R2_SUMMARY=""
R2_PUSH=0
r2_bash() {
  if has "${S}git([[:space:]]+(-[cC][[:space:]]+[^[:space:]]+|--?[A-Za-z-]+(=[^[:space:]]*)?))*[[:space:]]+push([[:space:]]|\$)"; then
    R2_SUMMARY="要把東西推到遠端（git push）"
    R2_PUSH=1
    return 0
  fi
  if has "${S}gh[[:space:]]+repo[[:space:]]+create" && has '--public'; then
    R2_SUMMARY="要建立公開的 repo"
    return 0
  fi
  if has "${S}gh[[:space:]]+repo[[:space:]]+edit" && hasi '--visibility[ =]+public'; then
    R2_SUMMARY="要把 repo 改成公開"
    return 0
  fi
  if has "${S}gh[[:space:]]+repo[[:space:]]+delete"; then
    R2_SUMMARY="要刪掉 repo"
    return 0
  fi
  if has "${S}gh[[:space:]]+(pr|issue|release|gist)[[:space:]]+(create|comment|merge|edit)"; then
    R2_SUMMARY="要在 GitHub 發布或留言"
    return 0
  fi
  if has "${S}gh[[:space:]]+api" && has '[[:space:]](-f|-F|--field|--raw-field|--input)([[:space:]=]|$)|-X[[:space:]]*(POST|PUT|PATCH|DELETE)'; then
    R2_SUMMARY="要用 GitHub API 寫入"
    return 0
  fi
  if has "${S}(rm|rmdir|unlink|shred|trash|trash-put)([[:space:]]|\$)" || has "${S}find[[:space:]].*-delete" || has "${S}git[[:space:]]+clean"; then
    R2_SUMMARY="要刪除檔案"
    return 0
  fi
  if http_send; then
    R2_SUMMARY="要用 curl/wget 把資料送出去"
    return 0
  fi
  return 1
}

# 安裝套件：pip、npm 系、系統套件管理員、cargo／gem／go 等。只認「帶套件名」的安裝（npm 系的裸 install 不算）。
pkg_install() {
  _flags='([[:space:]]+-[^[:space:]]+)*'
  has "${S}(pip[0-9.]*|pipx|conda|mamba|poetry)${_flags}[[:space:]]+(install|add)([[:space:]]|\$)" && return 0
  has "${S}python[0-9.]*${_flags}[[:space:]]+-m[[:space:]]+pip${_flags}[[:space:]]+install([[:space:]]|\$)" && return 0
  has "${S}uv[[:space:]]+(pip[[:space:]]+install|add|tool[[:space:]]+install)([[:space:]]|\$)" && return 0
  has "${S}(npm|pnpm|yarn|bun)${_flags}[[:space:]]+(install|i|add)[[:space:]]+[^[:space:]]" && return 0
  has "${S}yarn[[:space:]]+global[[:space:]]+add([[:space:]]|\$)" && return 0
  has "${S}(apt|apt-get|aptitude|dnf|yum|zypper|snap|brew|winget|choco|scoop|cargo|gem|go)${_flags}[[:space:]]+(install|reinstall)([[:space:]]|\$)" && return 0
  has "${S}(apk[[:space:]]+add|pacman[[:space:]]+-S[A-Za-z]*)([[:space:]]|\$)" && return 0
  return 1
}

# 路徑是不是「技能或外掛目錄」
is_skill_path() {
  case $1 in
    skills | skills/* | */skills | */skills/* | .claude/skills* | */.claude/skills* | plugins | plugins/* | */plugins | */plugins/*) return 0 ;;
  esac
  return 1
}

r4_scan() {
  for w in $(guard_tokens "$1"); do
    is_skill_path "$w" && hit ask R4 "先問：想把技能或外掛放進環境" "$R4_REASON"
  done
}

mcp_is_send() {
  _m=$(mcp_name)
  case $_m in _get_* | _list_* | _read_* | _search_* | _fetch_* | _find_* | _view_* | _query_*) return 1 ;; esac
  case $_m in
    *_send_* | *_sendmail_* | *_post_* | *_publish_* | *_share_* | *_delete_* | *_remove_* | *_trash_* | *_destroy_* | *_draft_* | *_forward_* | *_reply_* | *_pay_* | *_payment_* | *_purchase_* | *_checkout_* | *_tweet_*) return 0 ;;
  esac
  return 1
}

# 唯讀白名單：名稱含讀取動詞，而且完全沒有寫入動詞（get_or_delete 這種不算唯讀）。
mcp_is_readonly() {
  _m=$(mcp_name)
  case $_m in
    *_create_* | *_update_* | *_push_* | *_write_* | *_upload_* | *_navigate_* | *_type_* | *_fill_* | *_submit_* | *_delete_* | *_remove_* | *_send_* | *_post_* | *_publish_* | *_share_* | *_trash_* | *_destroy_* | *_draft_* | *_forward_* | *_reply_* | *_pay_* | *_purchase_* | *_checkout_* | *_tweet_* | *_edit_* | *_set_* | *_add_* | *_insert_* | *_put_* | *_patch_* | *_commit_* | *_merge_* | *_click_* | *_press_* | *_select_* | *_drop_* | *_move_* | *_rename_* | *_execute_* | *_run_* | *_eval_* | *_call_*) return 1 ;;
    *_get_* | *_list_* | *_read_* | *_search_* | *_find_* | *_view_* | *_query_*) return 0 ;;
  esac
  return 1
}

mcp_is_upload() {
  case $(mcp_name) in *_upload_*) return 0 ;; esac
  return 1
}

case $TOOL in
  Bash | PowerShell | Monitor)
    CMD=$(json_field command | json_plain)
    sweeps_home && hit ask R1 "先問：想搜尋或打包整個家目錄" "$R1_ASK_REASON"
    if r2_bash; then
      if flag_has && { [ "$R2_PUSH" = 1 ] || http_send; }; then
        r3_hit "$R3_SUMMARY"
      fi
      hit ask R2 "先問：$R2_SUMMARY" "$R2_REASON"
    fi
    if flag_has; then
      # 比對前先去掉 commit 訊息與註解；比完換回原指令給 R4 用。
      RAW=$CMD
      CMD=$(cmd_clean "$(json_field command)")
      other_send && r3_hit "$R3_SUMMARY"
      net_call && ! r3_dest_ok && r3_hit "$R3_SUMMARY"
      CMD=$RAW
    fi
    if has "${S}claude[[:space:]]+plugin[[:space:]]+(install|add|marketplace)"; then
      hit ask R4 "先問：想安裝外掛" "$R4_REASON"
    fi
    RAW=$CMD
    CMD=$(cmd_clean "$(json_field command)")
    pkg_install && hit ask R4 "先問：想安裝程式套件" "$R4_PKG_REASON"
    CMD=$RAW
    if cmd_writes "$CMD"; then
      r4_scan "$CMD"
    fi
    ;;
  Write | Edit | MultiEdit) r4_scan "$(json_field file_path)" ;;
  NotebookEdit) r4_scan "$(json_field notebook_path)" ;;
  mcp__*)
    if mcp_is_send; then
      if flag_has; then
        r3_hit "$R3_SUMMARY"
      fi
      hit ask R2 "先問：想用工具寄信、發文、分享或刪除" "$R2_REASON"
    fi
    if flag_has && ! mcp_is_readonly; then
      r3_hit "$R3_SUMMARY"
    fi
    ;;
  WebFetch)
    if flag_has; then
      URL=$(json_field url | json_plain)
      H=$(url_host "$URL")
      is_local_host "$H" && exit 0
      _p=${URL#*://}
      [ -n "$H" ] && dom_has "$H" && ! has_random "${_p#*/}" && exit 0
      r3_hit "$R3_SUMMARY"
    fi
    ;;
  WebSearch)
    flag_has && has_random "$(json_field query | json_plain)" && r3_hit "$R3_SEARCH_SUMMARY"
    ;;
esac
exit 0
