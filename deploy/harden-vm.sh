#!/usr/bin/env bash
# VM hardening script for claudeclaw deployment.
# Run as root on a fresh Ubuntu/Debian VM.
#
# Usage: sudo bash deploy/harden-vm.sh [TRUSTED_IP]
#   TRUSTED_IP — your IP for SSH/health access (default: allow from anywhere)

set -euo pipefail

TRUSTED_IP="${1:-}"
CLAW_USER="claudeclaw"
CLAW_HOME="/opt/claudeclaw"

echo "=== claudeclaw VM hardening ==="

# --- 1. Unattended security updates ---
echo "[1/6] Enabling unattended security updates..."
apt-get update -qq
apt-get install -y -qq unattended-upgrades apt-listchanges > /dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

# --- 2. SSH lockdown ---
echo "[2/6] Hardening SSH..."
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak

# Key-only auth, no root login, no password auth
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?UsePAM.*/UsePAM no/' /etc/ssh/sshd_config
sed -i 's/^#\?X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config

# Add if not present
grep -q "^MaxAuthTries" /etc/ssh/sshd_config || echo "MaxAuthTries 3" >> /etc/ssh/sshd_config
grep -q "^ClientAliveInterval" /etc/ssh/sshd_config || echo "ClientAliveInterval 300" >> /etc/ssh/sshd_config
grep -q "^ClientAliveCountMax" /etc/ssh/sshd_config || echo "ClientAliveCountMax 2" >> /etc/ssh/sshd_config

systemctl restart sshd

# --- 3. fail2ban ---
echo "[3/6] Installing fail2ban..."
apt-get install -y -qq fail2ban > /dev/null
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 5
bantime = 3600
findtime = 600
EOF
systemctl enable --now fail2ban

# --- 4. UFW firewall ---
echo "[4/6] Configuring firewall..."
apt-get install -y -qq ufw > /dev/null
ufw --force reset > /dev/null

# Default: deny inbound, allow outbound
ufw default deny incoming
ufw default allow outgoing

if [ -n "$TRUSTED_IP" ]; then
  ufw allow from "$TRUSTED_IP" to any port 22 proto tcp comment "SSH from trusted IP"
  ufw allow from "$TRUSTED_IP" to any port 9100 proto tcp comment "Health from trusted IP"
else
  ufw allow 22/tcp comment "SSH"
  # Health endpoint — localhost only by default when no trusted IP
  ufw allow from 127.0.0.1 to any port 9100 proto tcp comment "Health localhost"
  echo "  WARNING: No trusted IP provided. Health endpoint restricted to localhost."
  echo "  Re-run with: sudo bash deploy/harden-vm.sh YOUR_IP"
fi

ufw --force enable
ufw status verbose

# --- 5. Service user + file permissions ---
echo "[5/6] Setting up service user and file permissions..."
if ! id "$CLAW_USER" &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -d "$CLAW_HOME" "$CLAW_USER"
fi

mkdir -p "$CLAW_HOME/data"
chown -R "$CLAW_USER:$CLAW_USER" "$CLAW_HOME"

# Lock down secret files (from security audit)
chmod 700 "$CLAW_HOME/data"
if [ -f "$CLAW_HOME/data/settings.json" ]; then
  chmod 600 "$CLAW_HOME/data/settings.json"
fi
# Glob for extra-mcp.json files in agent dirs
find "$CLAW_HOME/data/agents" -name "extra-mcp.json" -exec chmod 600 {} \; 2>/dev/null || true
find "$CLAW_HOME/data" -name "x-cookies.json" -exec chmod 600 {} \; 2>/dev/null || true

# Source code is read-only for the service user
chmod -R o-rwx "$CLAW_HOME"

# --- 6. Journald log rotation ---
echo "[6/6] Configuring log rotation..."
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/claudeclaw.conf <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
Compress=yes
EOF
systemctl restart systemd-journald

echo ""
echo "=== Hardening complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy your SSH public key to the VM (ssh-copy-id user@vm)"
echo "  2. Install the systemd unit: sudo cp deploy/claudeclaw.service /etc/systemd/system/"
echo "  3. Reload and start: sudo systemctl daemon-reload && sudo systemctl enable --now claudeclaw"
echo "  4. Verify: curl http://localhost:9100/"
echo ""
echo "Firewall status:"
ufw status numbered
