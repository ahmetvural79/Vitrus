#!/usr/bin/env bash
# Vitrus tek-satır kurulum. Repo kökünden çalıştır:  ./install.sh
# Node >=18 gerektirir. Bağımlılık + build + örnek beyin + eval kapısı.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf "\033[1;32m▸\033[0m %s\n" "$1"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$1" >&2; }

if ! command -v node >/dev/null 2>&1; then err "Node.js gerekli (>=18)."; exit 1; fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then err "Node >=18 gerekli (mevcut: $(node -v))."; exit 1; fi
say "Node $(node -v)"

if [ -f package-lock.json ]; then say "bağımlılıklar (npm ci)"; npm ci; else say "bağımlılıklar (npm install)"; npm install; fi

say "build"; npm run build
say "tip kontrolü"; npm run typecheck

say "beyin başlatılıyor → .vitrus"; node dist/cli/index.js init
say "örnek korpus içe aktarılıyor"; node dist/cli/index.js import ./brain

say "eval kapısı"; npm run eval

cat <<'EOF'

✓ Vitrus hazır.

Dene:
  npm run dev -- think "incident nasıl çözülür"   # görünürlük yüzeyi (kaynak + boşluk + güven)
  npm run dev -- gaps                             # beynin bilmediği
  npm run demo                                    # uçtan uca (MCP) demo

Ajanına bağla (Claude Code): .mcp.json zaten tanımlı — bkz. QUICKSTART.md
EOF
