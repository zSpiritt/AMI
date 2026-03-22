#!/bin/bash

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   AMI — Assistant PocketMine         ║"
echo "  ║   Installation                       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

ok()   { echo -e "[SUCCES] $1"; }
warn() { echo -e "[WARNING] $1"; }
err()  { echo -e "[ERROR] $1"; exit 1; }
info() { echo -e "[INFO] $1"; }

REPO_URL="https://github.com/zSpiritt/AMI.git"
INSTALL_DIR="$HOME/.local/share/AMI"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
TMP_DIR="/tmp/AMI-build"
if command -v apt &>/dev/null; then
    PKG_MANAGER="apt"
elif command -v dnf &>/dev/null; then
    PKG_MANAGER="dnf"
elif command -v pacman &>/dev/null; then
    PKG_MANAGER="pacman"
else
    err "Gestionnaire de paquets non supporté, Installez les dépendances manuellement"
fi
install_pkg() {
    case $PKG_MANAGER in
        apt)    sudo apt-get install -y "$@" ;;
        dnf)    sudo dnf install -y "$@" ;;
        pacman) sudo pacman -S --noconfirm "$@" ;;
    esac
}
echo "  [1/5] Installation des dépendances système..."
echo ""
sudo apt-get update -qq 2>/dev/null || sudo dnf check-update -q 2>/dev/null || true
if ! command -v curl &>/dev/null; then
    info "Installation de curl..."
    install_pkg curl || err "Impossible d'installer curl"
fi
ok "curl"
if ! command -v git &>/dev/null; then
    info "Installation de git..."
    install_pkg git || err "Impossible d'installer git"
fi
ok "git"
install_pkg tar util-linux &>/dev/null
ok "tar + script"
info "Installation des libs Tauri..."
case $PKG_MANAGER in
    apt)
        install_pkg libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev \
            patchelf build-essential &>/dev/null
        ;;
    dnf)
        install_pkg webkit2gtk4.1-devel gtk3-devel \
            librsvg2-devel patchelf &>/dev/null
        ;;
    pacman)
        install_pkg webkit2gtk-4.1 gtk3 librsvg patchelf \
            base-devel &>/dev/null
        ;;
esac
ok "Libs Tauri"
echo ""
echo "  [2/5] Installation de Rust..."
echo ""
if command -v rustc &>/dev/null; then
    ok "Rust déjà installé ($(rustc --version))"
else
    info "Téléchargement de Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    source "$HOME/.cargo/env"
    ok "Rust installé ($(rustc --version))"
fi
export PATH="$HOME/.cargo/bin:$PATH"
echo ""
echo "  [3/5] Installation de Node.js..."
echo ""
if command -v node &>/dev/null; then
    ok "Node.js déjà installé ($(node --version))"
else
    info "Téléchargement de Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - &>/dev/null
    install_pkg nodejs &>/dev/null
    ok "Node.js installé ($(node --version))"
fi
echo ""
echo "  [4/5] Téléchargement et compilation d'AMI..."
echo ""
rm -rf "$TMP_DIR"
info "Clonage du repo..."
git clone "$REPO_URL" "$TMP_DIR" --depth=1 || err "Impossible de cloner le repo."
ok "Repo cloné"
cd "$TMP_DIR"
info "Installation des dépendances npm..."
npm install --silent || err "Échec de npm install"
ok "Dépendances npm installées"
info "Compilation..."
npm run tauri build -- --no-bundle 2>&1 | tail -5
ok "Compilation terminée"
echo ""
echo "  [5/5] Installation d'AMI..."
echo ""
mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"
BINARY=$(find "$TMP_DIR/src-tauri/target/release" -maxdepth 1 -type f -executable \
    \( -iname "ami" \) | head -1)
if [ -z "$BINARY" ]; then
    BINARY=$(find "$TMP_DIR/src-tauri/target/release" -maxdepth 1 -type f -executable \
        | grep -Ev "\.(d|rlib|so)$" \
        | grep -Ev "(build|deps|incremental)" \
        | head -1)
fi
[ -z "$BINARY" ] && err "Binaire compilé introuvable."
cp "$BINARY" "$INSTALL_DIR/ami"
chmod +x "$INSTALL_DIR/ami"
ok "Binaire installé"
if [ -f "$TMP_DIR/src-tauri/icons/icon.svg" ]; then
    cp "$TMP_DIR/src-tauri/icons/icon.svg" "$INSTALL_DIR/icon.svg"
    ok "Icône installée"
fi
ln -sf "$INSTALL_DIR/ami" "$BIN_DIR/ami"
ok "Commande 'ami' disponible dans $BIN_DIR"
cat > "$DESKTOP_DIR/ami.desktop" << EOF
[Desktop Entry]
Name=AMI
Comment=Assistant PocketMine
Exec=$INSTALL_DIR/ami
Icon=$INSTALL_DIR/icon.svg
Terminal=false
Type=Application
Categories=Game;
StartupWMClass=ami
EOF
chmod +x "$DESKTOP_DIR/ami.desktop"
ok "Raccourci bureau créé"
rm -rf "$TMP_DIR"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
for RC in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$RC" ] && ! grep -q '.local/bin' "$RC"; then
        echo "$PATH_LINE" >> "$RC"
    fi
done
export PATH="$HOME/.local/bin:$PATH"
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   AMI est installé avec succès !     ║"
echo "  ║   Lance : ami                        ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
if command -v ami &>/dev/null; then
    nohup ami &>/dev/null &
    disown
else
    warn "Redémarre ton terminal puis lance : ami"
fi
