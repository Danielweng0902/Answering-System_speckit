#!/usr/bin/env bash
# 檢查 Diagram First 規定：
# 1. 每個 diagrams/*.puml 都有同名 PNG，且 PNG 不比 .puml 舊。
# 2. specs/ 下每個子功能（NNN-name）都有組件圖、類別圖、時序圖：
#    diagrams/NNN-*component*.puml、NNN-*class*.puml、NNN-*seq*.puml
#
# 「PNG 不比 .puml 舊」怎麼比：
# - 檔案有 git 紀錄且工作區未修改 → 用**該檔案最後一次 commit 的時間**。
#   必須這樣做：CI 是全新 checkout，所有檔案的 mtime 都是 checkout 時間
#   （而且 checkout 順序不固定），直接比 mtime 會誤判「PNG 比 .puml 舊」
#   （2026-11-19 第一次加 GitHub Actions 就這樣紅的）。
# - 檔案還沒 commit（有未提交變更）或沒有 git 紀錄 → 用檔案 mtime，
#   這樣「剛改完 .puml 還沒重出 PNG」在本機仍然會被抓到。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
shopt -s nullglob
fail=0

# 檔案最後修改時間（秒）。優先用 git 最後一次 commit 的時間。
file_last_change_time() {
  local path="$1"
  local committed=""

  if git rev-parse --git-dir >/dev/null 2>&1; then
    committed="$(git log -1 --format=%ct -- "$path" 2>/dev/null | head -1)"
    # 有 commit 紀錄、而且工作區沒有未提交修改 → 用 commit 時間
    if [[ -n "$committed" ]] && git diff --quiet HEAD -- "$path" 2>/dev/null; then
      echo "$committed"
      return
    fi
  fi

  # 未追蹤或剛改過 → 用 mtime（macOS 用 -f、Linux 用 -c）
  stat -f %m "$path" 2>/dev/null || stat -c %Y "$path" 2>/dev/null || echo 0
}

# 淺層 clone（只有一筆 commit）時無法判斷 PNG 是否比 .puml 舊：
# `git log -1 -- <file>` 對任何檔案都會回同一個 tip commit 時間，
# 檢查會變成空轉。這裡直接明確報錯，不要靜默放行。
if git rev-parse --is-shallow-repository 2>/dev/null | grep -q '^true$'; then
  echo "FAIL 這是淺層 clone（沒有完整 git 歷史），無法判斷 PNG 是否比 .puml 舊。"
  echo "     請用完整歷史 checkout（CI：actions/checkout 的 fetch-depth: 0）。"
  fail=1
fi

for puml in diagrams/*.puml; do
  png="${puml%.puml}.png"
  if [[ ! -f "$png" ]]; then
    echo "FAIL 缺少 PNG：$png"; fail=1
    continue
  fi
  puml_time="$(file_last_change_time "$puml")"
  png_time="$(file_last_change_time "$png")"
  if [[ "$puml_time" =~ ^[0-9]+$ ]] && [[ "$png_time" =~ ^[0-9]+$ ]] &&
    (( png_time < puml_time )); then
    echo "FAIL PNG 比 .puml 舊，請重跑 scripts/render-diagrams.sh：$png"; fail=1
  fi
done

for dir in specs/[0-9][0-9][0-9]-*/; do
  num="$(basename "$dir" | cut -c1-3)"
  for kind in component class seq; do
    matches=(diagrams/"$num"*"$kind"*.puml)
    if (( ${#matches[@]} == 0 )); then
      echo "FAIL 子功能 $(basename "$dir") 缺少 $kind 圖（diagrams/$num-*$kind*.puml）"; fail=1
    fi
  done
done

if (( fail == 0 )); then echo "PASS 圖表檢查通過"; fi
exit $fail
