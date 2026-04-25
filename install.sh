#!/bin/bash
# ─────────────────────────────────────────────────────────────
# YoruSec Nox — 1-Command Installer
# Usage: bash <(curl -s https://raw.githubusercontent.com/yorusec/nox/main/install.sh)
# ─────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

NOX_DIR="/etc/yorusec/nox"
NOX_DATA="/var/lib/yorusec"
NOX_LOG="/var/log/yorusec-nox"
SERVICE_FILE="/etc/systemd/system/yorusec-nox.service"
NODE_MIN=20

banner() {
  echo -e "${CYAN}"
  echo "  ██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗███████╗███████╗ ██████╗"
  echo "  ╚██╗ ██╔╝██╔═══██╗██╔══██╗██║   ██║██╔════╝██╔════╝██╔════╝"
  echo "   ╚████╔╝ ██║   ██║██████╔╝██║   ██║███████╗█████╗  ██║"
  echo "    ╚██╔╝  ██║   ██║██╔══██╗██║   ██║╚════██║██╔══╝  ██║"
  echo "     ██║   ╚██████╔╝██║  ██║╚██████╔╝███████║███████╗╚██████╗"
  echo "     ╚═╝    ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝ ╚═════╝"
  echo -e "${NC}"
  echo -e "  ${BOLD}Nox Daemon Installer${NC}\n"
}

info()    { echo -e "  ${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "  ${YELLOW}[!]${NC} $1"; }
error()   { echo -e "  ${RED}[✗]${NC} $1"; exit 1; }
section() { echo -e "\n${CYAN}─── $1 ───${NC}"; }

check_root() {
  if [ "$EUID" -ne 0 ]; then
    error "Run as root: sudo bash install.sh"
  fi
}

check_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "OS: $PRETTY_NAME"
  fi
}

check_node() {
  section "Checking Node.js"
  if command -v node &>/dev/null; then
    NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
    if [ "$NODE_VER" -ge "$NODE_MIN" ]; then
      info "Node.js $NODE_VER found."
    else
      warn "Node.js $NODE_VER found but >= $NODE_MIN required. Installing..."
      install_node
    fi
  else
    warn "Node.js not found. Installing..."
    install_node
  fi
}

install_node() {
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN}.x | bash -
  apt-get install -y nodejs
  info "Node.js $(node -v) installed."
}

check_docker() {
  section "Checking Docker"
  if ! command -v docker &>/dev/null; then
    warn "Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
  fi
  info "Docker $(docker --version | cut -d' ' -f3 | tr -d ',') found."
}

install_nox() {
  section "Installing Nox"

  mkdir -p "$NOX_DIR" "$NOX_DATA/bots" "$NOX_DATA/backups" "$NOX_LOG"

  if [ -d "$NOX_DIR/.git" ]; then
    info "Updating existing installation..."
    cd "$NOX_DIR" && git pull
  else
    info "Cloning Nox..."
    git clone https://github.com/yorusec/nox.git "$NOX_DIR"
  fi

  cd "$NOX_DIR"
  npm install --production
  info "Dependencies installed."
}

configure_env() {
  section "Configuration"

  if [ -f "$NOX_DIR/.env" ]; then
    warn ".env already exists, skipping. Edit $NOX_DIR/.env manually if needed."
    return
  fi

  cp "$NOX_DIR/.env.example" "$NOX_DIR/.env"

  echo ""
  echo -e "  ${BOLD}Enter your Nox configuration:${NC}"
  echo ""

  read -rp "  Panel URL (e.g. https://panel.domain.com): " PANEL_URL
  read -rp "  Nox Token ID (from panel orbit creation): " TOKEN_ID
  read -rsp "  Nox Token (from panel orbit creation): " TOKEN
  echo ""
  read -rp "  Nox Port [8080]: " NOX_PORT
  NOX_PORT=${NOX_PORT:-8080}

  # Write to .env
  sed -i "s|PANEL_URL=.*|PANEL_URL=${PANEL_URL}|" "$NOX_DIR/.env"
  sed -i "s|NOX_TOKEN_ID=.*|NOX_TOKEN_ID=${TOKEN_ID}|" "$NOX_DIR/.env"
  sed -i "s|NOX_TOKEN=.*|NOX_TOKEN=${TOKEN}|" "$NOX_DIR/.env"
  sed -i "s|NOX_PORT=.*|NOX_PORT=${NOX_PORT}|" "$NOX_DIR/.env"

  info ".env configured."
}

install_service() {
  section "Installing systemd service"

  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=YoruSec Nox Daemon
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=${NOX_DIR}
EnvironmentFile=${NOX_DIR}/.env
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=5
StandardOutput=append:${NOX_LOG}/nox.log
StandardError=append:${NOX_LOG}/nox-error.log

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable yorusec-nox
  systemctl start  yorusec-nox

  sleep 2
  if systemctl is-active --quiet yorusec-nox; then
    info "Nox service is running!"
  else
    warn "Service may have failed. Check: journalctl -u yorusec-nox -n 50"
  fi
}

done_message() {
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   Nox Daemon installed successfully! 🎉  ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Config  : ${CYAN}${NOX_DIR}/.env${NC}"
  echo -e "  Logs    : ${CYAN}${NOX_LOG}/${NC}"
  echo -e "  Status  : ${CYAN}systemctl status yorusec-nox${NC}"
  echo -e "  Restart : ${CYAN}systemctl restart yorusec-nox${NC}"
  echo ""
  echo -e "  ${YELLOW}Go to your panel and set this Orbit's status to online!${NC}"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────
banner
check_root
check_os
check_node
check_docker
install_nox
configure_env
install_service
done_message
