#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# setup-opencode-tools.sh
# Cài đặt và cấu hình các công cụ AI cho OpenCode trong repo hiện tại.
# Hỗ trợ: Linux (x64/arm64), macOS (Intel/Apple Silicon)
# Chạy lại nhiều lần an toàn (idempotent).
# =============================================================================

REPO_DIR="$(pwd)"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*"; }
step()  { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# --- Detect OS ---
OS="$(uname -s)"
ARCH="$(uname -m)"

detect_platform() {
  case "$OS" in
    Linux)  PLATFORM="linux" ;;
    Darwin) PLATFORM="macos" ;;
    *)      err "Unsupported OS: $OS"; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64) ARCH_NORM="x64" ;;
    arm64|aarch64) ARCH_NORM="arm64" ;;
    *) err "Unsupported architecture: $ARCH"; exit 1 ;;
  esac
}

# --- Prerequisites ---
check_prerequisites() {
  step "Checking prerequisites"

  if ! command -v node &>/dev/null; then
    err "Node.js is required. Install from https://nodejs.org"
    exit 1
  fi
  ok "Node.js $(node --version)"

  if ! command -v npm &>/dev/null; then
    err "npm is required. Install Node.js from https://nodejs.org"
    exit 1
  fi
  ok "npm $(npm --version)"

  if ! command -v git &>/dev/null; then
    warn "git not found — some features may not work"
  else
    ok "git $(git --version | awk '{print $3}')"
  fi

  if command -v jq &>/dev/null; then
    ok "jq"
    USE_NODE_JSON=false
  else
    warn "jq not found — will use node for JSON operations"
    USE_NODE_JSON=true
  fi
}

# --- JSON helpers ---
# All JSON operations go through these functions.
# Uses jq if available, otherwise falls back to node.

_json_read() {
  local file="$1" query="$2"
  if [ "$USE_NODE_JSON" = true ]; then
    node -e "
      const f = JSON.parse(require('fs').readFileSync('$file','utf8'));
      const q = '$query';
      const keys = q.replace(/^\\.//,'').split('.');
      let o = f;
      for (const k of keys) { if (o === undefined || o === null) break; o = o[k]; }
      if (o === undefined || o === null) process.exit(1);
      if (typeof o === 'string') console.log(o);
      else console.log(JSON.stringify(o));
    " 2>/dev/null
  else
    jq -e "$query" "$file" 2>/dev/null
  fi
}

_json_has() {
  local file="$1" query="$2"
  _json_read "$file" "$query" &>/dev/null
}

_json_set() {
  local file="$1" path="$2" value="$3"
  # path is dot-separated, e.g. ".mcp.codegraph"
  if [ "$USE_NODE_JSON" = true ]; then
    node -e "
      const fs = require('fs');
      const obj = JSON.parse(fs.readFileSync('$file','utf8'));
      const keys = '$path'.replace(/^\\./,'').split('.');
      let o = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
        o = o[keys[i]];
      }
      o[keys[keys.length-1]] = JSON.parse('$value');
      fs.writeFileSync('$file', JSON.stringify(obj, null, 2) + '\n');
    "
  else
    local tmp
    tmp=$(jq "$path = $value" "$file")
    echo "$tmp" > "$file"
  fi
}

_json_append() {
  local file="$1" path="$2" value="$3"
  if [ "$USE_NODE_JSON" = true ]; then
    node -e "
      const fs = require('fs');
      const obj = JSON.parse(fs.readFileSync('$file','utf8'));
      const keys = '$path'.replace(/^\\./,'').split('.');
      let o = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
        o = o[keys[i]];
      }
      const last = keys[keys.length-1];
      if (!Array.isArray(o[last])) o[last] = [];
      const val = '$value';
      if (!o[last].includes(val)) o[last].push(val);
      fs.writeFileSync('$file', JSON.stringify(obj, null, 2) + '\n');
    "
  else
    local tmp
    tmp=$(jq "$path += [\"$value\"] | $path |= unique" "$file")
    echo "$tmp" > "$file"
  fi
}

# =============================================================================
# Ensure opencode.json exists with valid structure
# =============================================================================
ensure_opencode_json() {
  local config_file="$REPO_DIR/opencode.json"

  if [ ! -f "$config_file" ]; then
    info "Creating opencode.json..."
    cat > "$config_file" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
  "mcp": {}
}
EOF
    ok "opencode.json created"
  fi
}

# =============================================================================
# Tool 1: RTK (Rust Token Killer)
# =============================================================================
install_rtk() {
  step "RTK (Rust Token Killer)"

  if command -v rtk &>/dev/null; then
    local ver
    ver=$(rtk --version 2>/dev/null | awk '{print $2}')
    ok "rtk $ver already installed"
    return 0
  fi

  info "Installing rtk..."
  if [ "$PLATFORM" = "macos" ] && command -v brew &>/dev/null; then
    brew install rtk
  else
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  fi

  if command -v rtk &>/dev/null; then
    ok "rtk $(rtk --version 2>/dev/null | awk '{print $2}') installed"
  else
    warn "rtk may not be in PATH. Add ~/.local/bin to your PATH:"
    warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
  fi
}

# =============================================================================
# Tool 2: Superpowers (OpenCode plugin)
# =============================================================================
setup_superpowers() {
  step "Superpowers (OpenCode plugin)"

  local plugin_entry="superpowers@git+https://github.com/obra/superpowers.git"
  local config_file="$REPO_DIR/opencode.json"

  ensure_opencode_json

  # Check if superpowers is already in plugin array
  if _json_has "$config_file" '.plugin' && \
     _json_read "$config_file" '.plugin' | grep -q "superpowers"; then
    ok "superpowers plugin already configured"
    return 0
  fi

  info "Adding superpowers plugin..."
  _json_append "$config_file" '.plugin' "$plugin_entry"
  ok "superpowers plugin added"
}

# =============================================================================
# Tool 3: CodeGraph
# =============================================================================
install_codegraph() {
  step "CodeGraph"

  # Install binary if missing
  if ! command -v codegraph &>/dev/null; then
    info "Installing codegraph globally via npm..."
    npm install -g @colbymchenry/codegraph
    ok "codegraph $(codegraph --version 2>/dev/null) installed"
  else
    ok "codegraph $(codegraph --version 2>/dev/null) already installed"
  fi

  # Add MCP config
  local config_file="$REPO_DIR/opencode.json"
  ensure_opencode_json

  if _json_has "$config_file" '.mcp.codegraph'; then
    ok "codegraph MCP already configured"
  else
    info "Adding codegraph MCP config..."
    _json_set "$config_file" '.mcp.codegraph' '{"type":"local","command":["codegraph","serve","--mcp"],"enabled":true}'
    ok "codegraph MCP config added"
  fi

  # Initialize index if needed
  if [ -d "$REPO_DIR/.codegraph" ]; then
    ok "codegraph index already exists"
  else
    info "Initializing codegraph index (this may take a moment)..."
    cd "$REPO_DIR"
    codegraph init -i
    ok "codegraph index initialized"
  fi
}

# =============================================================================
# Tool 4: AgentMemory
# =============================================================================
install_agentmemory() {
  step "AgentMemory"

  # Install binary if missing
  if ! command -v agentmemory &>/dev/null; then
    info "Installing agentmemory globally via npm..."
    npm install -g @agentmemory/agentmemory
    ok "agentmemory installed"
  else
    ok "agentmemory already installed"
  fi

  # Add MCP config
  local config_file="$REPO_DIR/opencode.json"
  ensure_opencode_json

  if _json_has "$config_file" '.mcp.agentmemory'; then
    ok "agentmemory MCP already configured"
  else
    info "Adding agentmemory MCP config..."
    _json_set "$config_file" '.mcp.agentmemory' '{"type":"local","command":["npx","-y","@agentmemory/mcp"],"enabled":true,"env":{"AGENTMEMORY_URL":"http://localhost:3111"}}'
    ok "agentmemory MCP config added"
  fi
}

# =============================================================================
# Summary
# =============================================================================
print_summary() {
  step "Setup Complete"

  echo -e ""
  echo -e "${GREEN}Tools configured for:${NC} $REPO_DIR"
  echo -e ""
  echo -e "${CYAN}opencode.json:${NC}"
  cat "$REPO_DIR/opencode.json"
  echo -e ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo -e "  1. Start agentmemory server in a ${YELLOW}new terminal${NC}:"
  echo -e "     ${CYAN}agentmemory${NC}"
  echo -e "  2. Restart OpenCode to load the new MCP servers."
  echo -e ""
  echo -e "${GREEN}Done!${NC}"
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo -e "${CYAN}"
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║        OpenCode Tools Installer                     ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  detect_platform
  info "Platform: $PLATFORM ($ARCH_NORM)"

  check_prerequisites
  install_rtk
  setup_superpowers
  install_codegraph
  install_agentmemory
  print_summary
}

main "$@"
