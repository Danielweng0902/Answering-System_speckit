#!/usr/bin/env bash
# 把 diagrams/*.puml 轉成 PNG（同目錄）。PlantUML 版本固定，jar 下載到 tools/（不進版本控制）。
set -euo pipefail

VERSION="v1.2026.9"
EXPECTED_SHA256="aa4a1d06f8911c4b842beff4828dd955be431692b631a312d04c0e9fab9581de"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAR="$ROOT_DIR/tools/plantuml.jar"
URL="https://github.com/plantuml/plantuml/releases/download/$VERSION/plantuml.jar"

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

mkdir -p "$ROOT_DIR/tools"
if [[ ! -f "$JAR" || "$(sha256 "$JAR")" != "$EXPECTED_SHA256" ]]; then
  echo "下載 PlantUML $VERSION ..."
  curl -fL --connect-timeout 20 --max-time 300 "$URL" -o "$JAR.part"
  actual="$(sha256 "$JAR.part")"
  if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
    rm -f "$JAR.part"
    echo "PlantUML SHA-256 不符：$actual" >&2
    exit 1
  fi
  mv "$JAR.part" "$JAR"
fi

cd "$ROOT_DIR"
shopt -s nullglob
files=(diagrams/*.puml)
if (( ${#files[@]} == 0 )); then
  echo "diagrams/ 裡沒有 .puml 檔"
  exit 0
fi
# 課程指定指令：java -jar plantuml.jar "./diagrams/*.puml"
# 另加 -Playout=smetana（不需安裝 Graphviz）與 -charset UTF-8（中文標籤）。
java -jar "$JAR" -Playout=smetana -charset UTF-8 "./diagrams/*.puml"
echo "已產生 ${#files[@]} 張圖的 PNG"
