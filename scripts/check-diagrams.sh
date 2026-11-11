#!/usr/bin/env bash
# 檢查 Diagram First 規定：
# 1. 每個 diagrams/*.puml 都有同名 PNG，且 PNG 不比 .puml 舊。
# 2. specs/ 下每個子功能（NNN-name）都有組件圖、類別圖、時序圖：
#    diagrams/NNN-*component*.puml、NNN-*class*.puml、NNN-*seq*.puml
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
shopt -s nullglob
fail=0

for puml in diagrams/*.puml; do
  png="${puml%.puml}.png"
  if [[ ! -f "$png" ]]; then
    echo "FAIL 缺少 PNG：$png"; fail=1
  elif [[ "$puml" -nt "$png" ]]; then
    echo "FAIL PNG 比 .puml 舊，請重跑 scripts/render-diagrams.sh：$png"; fail=1
  fi
done

for dir in specs/[0-9][0-9][0-9]-*/; do
  num="$(basename "$dir" | cut -c1-3)"
  for kind in component class seq; do
    matches=(diagrams/"$num"-*"$kind"*.puml)
    if (( ${#matches[@]} == 0 )); then
      echo "FAIL 子功能 $(basename "$dir") 缺少 $kind 圖（diagrams/$num-*$kind*.puml）"; fail=1
    fi
  done
done

if (( fail == 0 )); then echo "PASS 圖表檢查通過"; fi
exit $fail
