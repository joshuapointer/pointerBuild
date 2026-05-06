#!/usr/bin/env bash
# Idempotent VPS bootstrap for pointerBuild.
# Targets Ubuntu/Debian. Re-run safe: each step checks state before acting.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/your-org/pointerBuild.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/pointerBuild}"
NODE_MAJOR="${NODE_MAJOR:-20}"
RUN_USER="${RUN_USER:-${SUDO_USER:-$(id -un)}}"

log() { printf '\033[1;36m[setup-vps]\033[0m %s\n' "$*"; }
need_root() {
  if [[ $EUID -ne 0 ]]; then
    exec sudo -E bash "$0" "$@"
  fi
}

apt_install() {
  local pkgs=("$@") missing=()
  for p in "${pkgs[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done
  if (( ${#missing[@]} )); then
    log "installing: ${missing[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  else
    log "apt packages already present: ${pkgs[*]}"
  fi
}

install_node() {
  if command -v node >/dev/null && node -v | grep -qE "^v${NODE_MAJOR}\."; then
    log "node ${NODE_MAJOR} already installed: $(node -v)"
    return
  fi
  log "installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt_install nodejs
}

install_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    log "docker + compose plugin already installed"
  else
    log "installing Docker Engine + compose plugin"
    apt_install ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    local codename
    codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
    cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable
EOF
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
  if id -nG "$RUN_USER" | grep -qw docker; then
    log "$RUN_USER already in docker group"
  else
    log "adding $RUN_USER to docker group (re-login required)"
    usermod -aG docker "$RUN_USER" || true
  fi
}

install_postgres_client() {
  apt_install postgresql-client
}

install_nginx_certbot() {
  apt_install nginx certbot python3-certbot-nginx
  systemctl enable --now nginx
}

clone_repo() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "repo already present, pulling latest"
    git -C "$INSTALL_DIR" pull --ff-only || log "git pull skipped"
  else
    log "cloning repo into $INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR"
}

bootstrap_env() {
  if [[ ! -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/.env.example" ]]; then
    log "creating .env from .env.example (EDIT THIS FILE before docker compose up)"
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
    chown "$RUN_USER":"$RUN_USER" "$INSTALL_DIR/.env"
  else
    log ".env already exists or no template found"
  fi
}

configure_firewall() {
  if command -v ufw >/dev/null; then
    ufw allow OpenSSH || true
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
    yes | ufw enable >/dev/null 2>&1 || true
    log "ufw rules ensured"
  fi
}

main() {
  need_root "$@"
  log "starting (user=$RUN_USER, dir=$INSTALL_DIR)"
  apt_install git curl ca-certificates ufw
  install_node
  install_docker
  install_postgres_client
  install_nginx_certbot
  clone_repo
  bootstrap_env
  configure_firewall
  log "done. Next:"
  log "  1) Edit $INSTALL_DIR/.env"
  log "  2) cd $INSTALL_DIR && docker compose up -d --build"
  log "  3) certbot --nginx -d updates.\$DOMAIN -d deploy.\$DOMAIN -d storage.\$DOMAIN"
}

main "$@"
