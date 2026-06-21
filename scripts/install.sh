#!/usr/bin/env bash
set -euo pipefail

REPO="Amar033/Blonde-code"
INSTALL_DIR="${BLONDE_INSTALL_DIR:-$HOME/.local/bin}"

# ── Detect platform ────────────────────────────────────────────────────────────

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  OS_NAME="linux" ;;
  darwin) OS_NAME="darwin" ;;
  *)
    echo "Unsupported OS: $OS"
    echo "Download manually from: https://github.com/$REPO/releases/latest"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64)          ARCH_NAME="x64" ;;
  aarch64 | arm64) ARCH_NAME="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET="blonde-${OS_NAME}-${ARCH_NAME}"

# ── Resolve latest version ─────────────────────────────────────────────────────

echo "Fetching latest blonde release…"
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$LATEST" ]; then
  echo "Could not determine latest version. Check your internet connection."
  exit 1
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/$ASSET"

# ── Download ───────────────────────────────────────────────────────────────────

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "Downloading blonde $LATEST for ${OS_NAME}/${ARCH_NAME}…"
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

# ── Install ────────────────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
mv "$TMP" "$INSTALL_DIR/blonde"

echo ""
echo "✓  blonde $LATEST installed to $INSTALL_DIR/blonde"

# ── PATH hint ─────────────────────────────────────────────────────────────────

if ! command -v blonde &>/dev/null; then
  echo ""
  echo "  '$INSTALL_DIR' is not in your PATH. Add this to your shell config:"
  echo ""
  echo '    export PATH="$HOME/.local/bin:$PATH"'
  echo ""
  echo "  Then restart your terminal, or run:"
  echo '    source ~/.bashrc  # or ~/.zshrc'
fi

echo ""
echo "  Run 'blonde' from any project directory to start a session."
echo "  Run 'blonde --update' to update to the latest version."
