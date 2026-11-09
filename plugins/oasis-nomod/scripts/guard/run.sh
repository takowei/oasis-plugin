#!/bin/sh
# 守衛入口：sh run.sh hard|soft|post。讀 hook 的 JSON，轉成 Claude Code 認得的決定。
# 核心腳本壞掉時：hard（R1/R5）改成擋下，soft（R2/R3/R4）改成先問。永遠不讓工具默默放行。
mode=$1
dir=$(dirname "$0")
input=$(cat)

# 日誌只寫日期、規則編號、白話摘要，絕不寫指令全文。取不到資料夾就跳過，不讓 hook 失敗。
log_event() {
  d=${CLAUDE_PLUGIN_OPTION_DATA_DIR:-}
  case $d in "~"*) d="$HOME${d#\~}" ;; esac
  [ -n "$d" ] && [ -d "$d" ] || return 0
  [ -f "$d/guard-log.md" ] || printf '# 守衛日誌\n\n' >>"$d/guard-log.md" 2>/dev/null
  printf -- '- %s｜%s｜%s\n' "$(date '+%Y-%m-%d %H:%M')" "$1" "$2" >>"$d/guard-log.md" 2>/dev/null
  return 0
}

if [ "$mode" = post ]; then
  printf '%s' "$input" | sh "$dir/post.sh" >/dev/null 2>&1
  exit 0
fi

out=$(printf '%s' "$input" | sh "$dir/$mode.sh" 2>/dev/null)
rc=$?
out=$(printf '%s\n' "$out" | head -n 1)
tab=$(printf '\t')

case $rc:$out in
  0:) exit 0 ;;
  0:deny"$tab"* | 0:ask"$tab"*)
    kind=${out%%"$tab"*}
    rest=${out#*"$tab"}
    rule=${rest%%"$tab"*}
    rest=${rest#*"$tab"}
    summary=${rest%%"$tab"*}
    reason=${rest#*"$tab"}
    ;;
  *)
    if [ "$mode" = hard ]; then
      kind=deny rule="R1/R5" summary="擋下：守衛腳本出錯，保險起見不放行"
      reason="防護腳本出了問題，為了安全先不放行這個動作。請告訴維護的人。"
    else
      kind=ask rule="R2/R3/R4" summary="先問：守衛腳本出錯，保險起見先問"
      reason="守衛腳本出了問題，保險起見請你確認這個動作再繼續。"
    fi
    ;;
esac

log_event "$rule" "$summary"
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$kind" "$reason"
exit 0
