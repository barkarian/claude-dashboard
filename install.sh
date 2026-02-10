#!/bin/bash
set -e

echo "==============================="
echo "  Claude Dashboard Installer"
echo "==============================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_command() {
  if command -v "$1" &> /dev/null; then
    echo -e "${GREEN}✓${NC} $1 found"
    return 0
  else
    echo -e "${RED}✗${NC} $1 not found"
    return 1
  fi
}

# 1. Check prerequisites
echo "Checking prerequisites..."
echo ""

check_command node || {
  echo -e "${YELLOW}Node.js is required. Install it from https://nodejs.org or via nvm:${NC}"
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  echo "  nvm install 20"
  exit 1
}

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ required, found v$(node -v)${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js v$(node -v)"

check_command npm || { echo "npm is required"; exit 1; }
check_command git || { echo "git is required"; exit 1; }

if command -v claude &> /dev/null; then
  echo -e "${GREEN}✓${NC} Claude Code CLI found"
else
  echo -e "${YELLOW}⚠${NC} Claude Code CLI not found. Install it for chat features."
  echo "  See: https://docs.anthropic.com/claude-code"
fi

echo ""

# 2. Determine install directory
INSTALL_DIR="${INSTALL_DIR:-$HOME/.claude-dashboard}"

if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Directory $INSTALL_DIR already exists.${NC}"
  read -p "Overwrite? (y/n): " OVERWRITE
  if [ "$OVERWRITE" != "y" ]; then
    echo "Aborting."
    exit 1
  fi
  rm -rf "$INSTALL_DIR"
fi

# 3. Copy/clone the dashboard
echo "Installing to $INSTALL_DIR..."

if [ -d "$(dirname "$0")/server" ]; then
  # Running from the repo directory
  cp -r "$(dirname "$0")" "$INSTALL_DIR"
else
  echo "Please run this script from the claude-dashboard directory."
  exit 1
fi

cd "$INSTALL_DIR"

# 4. Install dependencies
echo ""
echo "Installing dependencies..."
npm install 2>&1 | tail -5
echo -e "${GREEN}✓${NC} Dependencies installed"

# 5. Build the client
echo "Building client..."
npm run build 2>&1 | tail -3
echo -e "${GREEN}✓${NC} Client built"

# 6. Interactive configuration
echo ""
echo "--- Configuration ---"
echo ""

# Password
while true; do
  read -sp "Set a dashboard password: " PASSWORD
  echo ""
  if [ -z "$PASSWORD" ]; then
    echo -e "${YELLOW}Password cannot be empty${NC}"
    continue
  fi
  read -sp "Confirm password: " PASSWORD_CONFIRM
  echo ""
  if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
    echo -e "${RED}Passwords do not match${NC}"
    continue
  fi
  break
done

HASH=$(node -e "
  import('bcrypt').then(bcrypt => {
    bcrypt.hash('$PASSWORD', 10).then(h => console.log(h));
  });
")

SESSION_SECRET=$(openssl rand -hex 32)

# GitHub token
echo ""
read -p "GitHub personal access token (optional, for repo listing): " GITHUB_TOKEN

# Projects directory
read -p "Projects directory [$HOME/claude-projects]: " PROJECTS_PATH
PROJECTS_PATH=${PROJECTS_PATH:-"$HOME/claude-projects"}
mkdir -p "$PROJECTS_PATH"

# Port
read -p "Port [2222]: " PORT
PORT=${PORT:-2222}

# 7. Write .env file
cat > .env << ENVEOF
PORT=$PORT
NODE_ENV=production
DASHBOARD_PASSWORD_HASH=$HASH
SESSION_SECRET=$SESSION_SECRET
GITHUB_TOKEN=$GITHUB_TOKEN
PROJECTS_PATH=$PROJECTS_PATH
ENVEOF

echo -e "${GREEN}✓${NC} Configuration saved"

# 8. Cloudflare Tunnel (optional)
echo ""
read -p "Set up Cloudflare Tunnel for remote access? (y/n): " SETUP_TUNNEL

if [ "$SETUP_TUNNEL" = "y" ]; then
  if ! check_command cloudflared; then
    echo "Installing cloudflared..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
      if command -v brew &> /dev/null; then
        brew install cloudflared
      else
        echo -e "${RED}Please install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/${NC}"
        SETUP_TUNNEL="n"
      fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      ARCH=$(uname -m)
      if [ "$ARCH" = "x86_64" ]; then
        curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
        sudo dpkg -i /tmp/cloudflared.deb
        rm /tmp/cloudflared.deb
      elif [ "$ARCH" = "aarch64" ]; then
        curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
        sudo dpkg -i /tmp/cloudflared.deb
        rm /tmp/cloudflared.deb
      fi
    fi
  fi

  if [ "$SETUP_TUNNEL" = "y" ] && command -v cloudflared &> /dev/null; then
    echo ""
    echo "Logging in to Cloudflare..."
    cloudflared tunnel login

    read -p "Tunnel name [claude-dashboard]: " TUNNEL_NAME
    TUNNEL_NAME=${TUNNEL_NAME:-"claude-dashboard"}

    cloudflared tunnel create "$TUNNEL_NAME"

    read -p "Domain (e.g., dashboard.yourdomain.com): " DOMAIN

    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
    mkdir -p ~/.cloudflared

    cat > ~/.cloudflared/config.yml << CEOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
CEOF

    cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN"
    echo -e "${GREEN}✓${NC} Tunnel configured for https://$DOMAIN"
  fi
fi

# 9. Create systemd service (Linux only)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo ""
  read -p "Create systemd service for auto-start? (y/n): " CREATE_SERVICE

  if [ "$CREATE_SERVICE" = "y" ]; then
    sudo tee /etc/systemd/system/claude-dashboard.service > /dev/null << SVCEOF
[Unit]
Description=Claude Dashboard
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

    sudo systemctl daemon-reload
    sudo systemctl enable claude-dashboard
    sudo systemctl start claude-dashboard
    echo -e "${GREEN}✓${NC} Systemd service created and started"

    if [ "$SETUP_TUNNEL" = "y" ]; then
      sudo cloudflared service install 2>/dev/null || true
    fi
  fi
fi

# 10. Create macOS launch agent (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo ""
  read -p "Create launchd agent for auto-start? (y/n): " CREATE_AGENT

  if [ "$CREATE_AGENT" = "y" ]; then
    mkdir -p ~/Library/LaunchAgents
    cat > ~/Library/LaunchAgents/com.claude-dashboard.plist << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$INSTALL_DIR/server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/claude-dashboard.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/claude-dashboard.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
PLISTEOF

    launchctl load ~/Library/LaunchAgents/com.claude-dashboard.plist
    echo -e "${GREEN}✓${NC} LaunchAgent created and loaded"
  fi
fi

# Done!
echo ""
echo "==============================="
echo -e "  ${GREEN}Installation Complete!${NC}"
echo "==============================="
echo ""
echo "Dashboard URL: http://localhost:$PORT"
if [ "$SETUP_TUNNEL" = "y" ] && [ -n "$DOMAIN" ]; then
  echo "Remote URL:    https://$DOMAIN"
fi
echo ""
echo "Quick start:"
echo "  cd $INSTALL_DIR && npm start"
echo ""
echo "For development:"
echo "  cd $INSTALL_DIR && npm run dev"
echo ""
if [[ "$OSTYPE" == "linux-gnu"* ]] && [ "$CREATE_SERVICE" = "y" ]; then
  echo "Service commands:"
  echo "  sudo systemctl status claude-dashboard"
  echo "  sudo systemctl restart claude-dashboard"
  echo "  journalctl -u claude-dashboard -f"
fi
if [[ "$OSTYPE" == "darwin"* ]] && [ "$CREATE_AGENT" = "y" ]; then
  echo "Service commands:"
  echo "  launchctl list | grep claude"
  echo "  tail -f ~/Library/Logs/claude-dashboard.log"
fi
