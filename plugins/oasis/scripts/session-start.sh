#!/bin/sh
# SessionStart 輕量提示：只輸出一行，絕不把城市資料原文放進對話。
# 設計借鏡 IamBlum/pm-copilot 的 load-memory.sh（MIT，見 THIRD_PARTY_NOTICES）：
# 開場只給「指標」不灌全文；沒設定過就給一句怎麼開始。
# POSIX sh，不連網。讀的東西只有：goals/、districts/ 底下 *.md 的檔名與大小，
# 以及每張街區卡第一行（是不是 ---）與第一個 state: 行（只拿來計數，不輸出）。
# 任何情況都 exit 0，不讓 hook 失敗。
LC_ALL=C
export LC_ALL
# 單檔上限：超過就當疑似損毀，不去讀內容
MAX_BYTES=65536

cat >/dev/null 2>&1

d=${CLAUDE_PLUGIN_OPTION_DATA_DIR:-"~/workspace/oasis-city"}
case $d in "~"*) d="$HOME${d#\~}" ;; esac

goals=0
cards=0
quests=0
broken=0

# 檔案大小（位元組）；讀不到印空字串
size_of() {
  wc -c <"$1" 2>/dev/null | tr -d ' '
}

# 合法卡片：非空、不超過上限、第一行是 ---
card_ok() {
  s=$(size_of "$1")
  case $s in '' | *[!0-9]*) return 1 ;; esac
  [ "$s" -gt 0 ] && [ "$s" -le "$MAX_BYTES" ] || return 1
  first=$(head -n 1 "$1" 2>/dev/null | tr -d '\r')
  [ "$first" = "---" ]
}

if [ -d "$d/goals" ]; then
  for f in "$d/goals"/*.md; do
    [ -e "$f" ] || continue
    if [ -f "$f" ] && card_ok "$f"; then
      goals=$((goals + 1))
    else
      broken=$((broken + 1))
    fi
  done
elif [ -e "$d/goals" ]; then
  broken=$((broken + 1))
fi

if [ -d "$d/districts" ]; then
  for f in "$d/districts"/*.md; do
    [ -e "$f" ] || continue
    if [ -f "$f" ] && card_ok "$f"; then
      cards=$((cards + 1))
      st=$(grep -m1 -E '^state[[:space:]]*:' "$f" 2>/dev/null | sed 's/^state[[:space:]]*:[[:space:]]*//; s/[[:space:]]*#.*$//; s/[[:space:]]*$//;s/^"\(.*\)"$/\1/')
      [ "$st" = "waiting" ] && quests=$((quests + 1))
    else
      broken=$((broken + 1))
    fi
  done
elif [ -e "$d/districts" ]; then
  broken=$((broken + 1))
fi

if [ $((goals + cards + broken)) -eq 0 ]; then
  printf '【綠洲】還沒開局：說『開局』就能建城。\n'
  exit 0
fi

note=""
[ "$broken" -gt 0 ] && note="，$broken 張卡片疑似損毀（畫地圖時會列出）"
printf '【綠洲】城市摘要：目標 %d 個、建築 %d 棟、待辦「！」%d 個%s。說『更新地圖』收工。\n' \
  "$goals" "$cards" "$quests" "$note"
exit 0
