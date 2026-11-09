#!/bin/sh
# R3 的前半：讀過外部內容就記一個旗標（以 session_id 為鍵）；工具真的執行成功了，就把它連到的網域記成
# 「這個 session 已允許」。永遠不擋、不出聲。
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
guard_load
TOOL=$(json_field tool_name)
set -f

# 讀進外部內容的來源：網頁、信件、issue、遠端 repo、腳本連網、使用者下載的信件或網頁檔。
reads_external() {
  case $TOOL in
    WebFetch | WebSearch) return 0 ;;
    mcp__*)
      _n=$(printf '%s' "$TOOL" | lower)
      case $_n in
        *fetch* | *browse* | *read_url* | *get_message* | *get_thread* | *read_file_content* | *scrape* | *crawl* | *navigate* | *read_email* | *get_email*) return 0 ;;
        *issue* | *history* | *message* | *thread* | *email* | *comment* | *channel* | *pull_request* | *discussion* | *inbox* | *feed*) return 0 ;;
      esac
      ;;
    Read)
      _f=$(json_field file_path | json_plain | lower)
      case $_f in *.eml | *.msg | *.mbox | *.html | *.htm | */downloads/*) return 0 ;; esac
      ;;
    Bash | PowerShell | Monitor)
      _c=$(json_field command | json_plain)
      printf '%s' "$_c" | grep -Eiq '(^|[[:space:];&|(`])(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)([[:space:]]|$)' && return 0
      printf '%s' "$_c" | grep -Eiq '(^|[[:space:];&|(`])gh[[:space:]]+((issue|pr|release|gist|run|discussion)[[:space:]]+(view|list|diff|checks|download)|api|search)' && return 0
      printf '%s' "$_c" | grep -Eiq '(^|[[:space:];&|(`])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(clone|fetch|pull|ls-remote)([[:space:]]|$)' && return 0
      printf '%s' "$_c" | grep -Eiq '(^|[[:space:];&|(`])(python3?|node|bun|deno|perl|ruby|php)[[:space:]].*(urllib|urlopen|requests|httpx|http\.client|fetch|axios|XMLHttpRequest|net/http|open-uri|LWP|https?://)' && return 0
      ;;
  esac
  return 1
}

# 只有 PostToolUse（成功執行）才記網域；PostToolUseFailure（失敗）不記。
# hook 拿不到使用者有沒有按允許，但工具會執行，就表示使用者允許了或本來就允許。
remember_domains() {
  [ "$(json_field hook_event_name)" = PostToolUse ] || return 0
  case $TOOL in
    WebFetch) dom_add "$(url_host "$(json_field url | json_plain)")" ;;
    Bash | PowerShell | Monitor)
      for _h in $(cmd_hosts "$(cmd_clean "$(json_field command)")"); do
        dom_add "$_h"
      done
      ;;
  esac
  return 0
}
remember_domains

if reads_external; then
  flag_set
  for d in $(flag_dirs); do
    [ -d "$d" ] && find "$d" \( -name 'ext-*' -o -name 'dom-*' \) -mtime +2 -exec rm -f {} + 2>/dev/null
  done
fi
exit 0
