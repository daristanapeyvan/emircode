#!/usr/bin/env bash
# ==============================================================================
# Emir Code - Linux Graphical & Interactive Installer Wizard
# ==============================================================================
# Mirrors Windows NSIS graphical installer on Linux desktop environments.
# Supports: Zenity (GNOME/GTK), KDialog (KDE Plasma), and Terminal Interactive Fallback.
# ==============================================================================

set -e

APP_NAME="Emir Code"
APP_EXEC_NAME="emir-code"
# Replaced with the package.json version when the release is built (.github/workflows/release.yml).
APP_VERSION="1.6.0"
RELEASE_URL="https://github.com/daristanapeyvan/emircode/releases/download/v$APP_VERSION/emir-code-$APP_VERSION.tar.gz"
APP_COMMENT="AI Native Coding Agent Desktop Client"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect installation source directory (where the unpacked binaries or tarball are)
SOURCE_DIR="$SCRIPT_DIR"
if [ -d "$SCRIPT_DIR/release/linux-unpacked" ]; then
    SOURCE_DIR="$SCRIPT_DIR/release/linux-unpacked"
elif [ -d "$SCRIPT_DIR/linux-unpacked" ]; then
    SOURCE_DIR="$SCRIPT_DIR/linux-unpacked"
elif [ ! -f "$SCRIPT_DIR/emir-code" ] && [ -d "$SCRIPT_DIR/../release/linux-unpacked" ]; then
    SOURCE_DIR="$SCRIPT_DIR/../release/linux-unpacked"
fi

# Detect GUI tool (zenity, kdialog, or none)
GUI_MODE="cli"
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
    if command -v zenity >/dev/null 2>&1; then
        GUI_MODE="zenity"
    elif command -v kdialog >/dev/null 2>&1; then
        GUI_MODE="kdialog"
    fi
fi

# Localization / Dil Desteği
LANG_ENV="${LANG:-en}"
IS_TR=0
if [[ "$LANG_ENV" =~ ^tr ]]; then
    IS_TR=1
fi

# Localization strings
if [ "$IS_TR" -eq 1 ]; then
    MSG_TITLE="Emir Code Kurulum Sihirbazı (v$APP_VERSION)"
    MSG_WELCOME="Emir Code v$APP_VERSION Kurulum Sihirbazına Hoş Geldiniz!\n\nYerel yapay zeka (Ollama) destekli otonom yazılım mühendisi Emir Code, Linux sisteminize kurulmak üzere yapılandırılacaktır.\n\nDevam etmek istiyor musunuz?"
    MSG_CHOOSE_DIR="Lütfen Emir Code'un kurulacağı hedef klasörü seçin:"
    MSG_OPTIONS="Lütfen kurulmasını istediğiniz ek bileşenleri seçin:"
    OPT_DESKTOP="Masaüstü kısayolu oluştur"
    OPT_MENU="Uygulamalar menüsüne ekle"
    OPT_CLI="Terminal komutunu ekle (~/.local/bin/emir-code)"
    MSG_PREREQ_TITLE="Sistem Önkoşul Denetimi"
    MSG_OLLAMA_FOUND="✓ Ollama bulundu ve hazır."
    MSG_OLLAMA_MISSING="⚠ Ollama bulunamadı! Emir Code yerel LLM çalıştırmak için Ollama gerektirir. Şimdi resmi kaynaktan (ollama.com) indirmek ister misiniz?"
    MSG_INSTALLING="Emir Code dosyaları kopyalanıyor ve sistem entegrasyonu yapılıyor..."
    MSG_SUCCESS="Emir Code başarıyla kuruldu!\n\nKurulum Yeri: %s\n\nEmir Code'u şimdi başlatmak ister misiniz?"
    MSG_CANCELLED="Kurulum kullanıcı tarafından iptal edildi."
    MSG_DOWNLOADING="Uygulama dosyaları indiriliyor:"
    MSG_NO_FILES="Emir Code dosyaları bulunamadı ve indirilemedi.\n\nemir-code-$APP_VERSION.tar.gz dosyasını GitHub sürüm sayfasından indirip bu betikle aynı klasöre koyun ve kurulumu yeniden çalıştırın."
else
    MSG_TITLE="Emir Code Setup Wizard (v$APP_VERSION)"
    MSG_WELCOME="Welcome to the Emir Code v$APP_VERSION Setup Wizard!\n\nEmir Code - AI Native Autonomous Coding Agent will be installed and integrated with your Linux desktop.\n\nDo you wish to continue?"
    MSG_CHOOSE_DIR="Please choose the target installation directory:"
    MSG_OPTIONS="Select the components you want to install:"
    OPT_DESKTOP="Create Desktop shortcut"
    OPT_MENU="Add to Applications menu"
    OPT_CLI="Install terminal command (~/.local/bin/emir-code)"
    MSG_PREREQ_TITLE="Prerequisites Check"
    MSG_OLLAMA_FOUND="✓ Ollama is detected and ready."
    MSG_OLLAMA_MISSING="⚠ Ollama is not detected! Emir Code requires Ollama to run local LLMs. Would you like to install Ollama now?"
    MSG_INSTALLING="Copying Emir Code binaries and integrating with desktop..."
    MSG_SUCCESS="Emir Code has been successfully installed!\n\nLocation: %s\n\nWould you like to launch Emir Code now?"
    MSG_CANCELLED="Installation was cancelled by the user."
    MSG_DOWNLOADING="Downloading the application files:"
    MSG_NO_FILES="The Emir Code files were not found and could not be downloaded.\n\nDownload emir-code-$APP_VERSION.tar.gz from the GitHub release page, put it next to this script and run the setup again."
fi

# ==============================================================================
# STEP 1: WELCOME DIALOG
# ==============================================================================
if [ "$GUI_MODE" = "zenity" ]; then
    if ! zenity --question --title="$MSG_TITLE" --text="$MSG_WELCOME" --width=450 --height=220 2>/dev/null; then
        echo "$MSG_CANCELLED"
        exit 0
    fi
elif [ "$GUI_MODE" = "kdialog" ]; then
    if ! kdialog --title "$MSG_TITLE" --yesno "$MSG_WELCOME" 2>/dev/null; then
        echo "$MSG_CANCELLED"
        exit 0
    fi
else
    echo "============================================================"
    echo "  $MSG_TITLE"
    echo "============================================================"
    echo -e "$MSG_WELCOME"
    read -rp "Devam etmek istiyor musunuz / Continue? [Y/n]: " choice
    if [[ "$choice" =~ ^[Nn] ]]; then
        echo "$MSG_CANCELLED"
        exit 0
    fi
fi

# ==============================================================================
# STEP 2: INSTALLATION DIRECTORY
# ==============================================================================
DEFAULT_INSTALL_DIR="$HOME/.local/share/emir-code"
INSTALL_DIR="$DEFAULT_INSTALL_DIR"

if [ "$GUI_MODE" = "zenity" ]; then
    USER_DIR=$(zenity --file-selection --directory --title="$MSG_CHOOSE_DIR" --filename="$DEFAULT_INSTALL_DIR" 2>/dev/null || echo "")
    if [ -n "$USER_DIR" ]; then
        INSTALL_DIR="$USER_DIR"
    fi
elif [ "$GUI_MODE" = "kdialog" ]; then
    USER_DIR=$(kdialog --getexistingdirectory "$DEFAULT_INSTALL_DIR" --title "$MSG_CHOOSE_DIR" 2>/dev/null || echo "")
    if [ -n "$USER_DIR" ]; then
        INSTALL_DIR="$USER_DIR"
    fi
else
    read -rp "Kurulum Dizini / Installation Directory [$DEFAULT_INSTALL_DIR]: " USER_DIR
    if [ -n "$USER_DIR" ]; then
        INSTALL_DIR="$USER_DIR"
    fi
fi

# Expand tilde or relative path
INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
mkdir -p "$INSTALL_DIR"

# ==============================================================================
# STEP 3: SHORTCUT OPTIONS
# ==============================================================================
DO_DESKTOP=1
DO_MENU=1
DO_CLI=1

if [ "$GUI_MODE" = "zenity" ]; then
    CHECK_OUTPUT=$(zenity --list --checklist --title="$MSG_TITLE" --text="$MSG_OPTIONS" \
        --column="Seç" --column="Bileşen" \
        TRUE "$OPT_DESKTOP" \
        TRUE "$OPT_MENU" \
        TRUE "$OPT_CLI" --width=450 --height=240 2>/dev/null || echo "ALL")
    
    if [ "$CHECK_OUTPUT" != "ALL" ]; then
        [[ "$CHECK_OUTPUT" =~ "$OPT_DESKTOP" ]] || DO_DESKTOP=0
        [[ "$CHECK_OUTPUT" =~ "$OPT_MENU" ]] || DO_MENU=0
        [[ "$CHECK_OUTPUT" =~ "$OPT_CLI" ]] || DO_CLI=0
    fi
fi

# ==============================================================================
# STEP 4: PREREQUISITES CHECK (OLLAMA)
# ==============================================================================
OLLAMA_FOUND=0
if command -v ollama >/dev/null 2>&1 || [ -f "/usr/local/bin/ollama" ] || [ -f "$HOME/.local/bin/ollama" ]; then
    OLLAMA_FOUND=1
fi

if [ "$OLLAMA_FOUND" -eq 0 ]; then
    INSTALL_OLLAMA=0
    if [ "$GUI_MODE" = "zenity" ]; then
        if zenity --question --title="$MSG_PREREQ_TITLE" --text="$MSG_OLLAMA_MISSING" --width=450 --height=200 2>/dev/null; then
            INSTALL_OLLAMA=1
        fi
    elif [ "$GUI_MODE" = "kdialog" ]; then
        if kdialog --title "$MSG_PREREQ_TITLE" --yesno "$MSG_OLLAMA_MISSING" 2>/dev/null; then
            INSTALL_OLLAMA=1
        fi
    else
        echo -e "\n$MSG_OLLAMA_MISSING"
        read -rp "[y/N]: " ochoice
        if [[ "$ochoice" =~ ^[Yy] ]]; then
            INSTALL_OLLAMA=1
        fi
    fi

    if [ "$INSTALL_OLLAMA" -eq 1 ]; then
        echo "Installing Ollama via official installer..."
        curl -fsSL https://ollama.com/install.sh | sh || true
    fi
fi

# ==============================================================================
# STEP 5: COPY APPLICATION FILES & PERMISSIONS
# ==============================================================================
echo "Installing Emir Code to $INSTALL_DIR..."
if [ -d "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/emir-code" ]; then
    cp -r "$SOURCE_DIR"/* "$INSTALL_DIR/"
elif [ -f "$SCRIPT_DIR/emir-code" ]; then
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
else
    # Tarball next to the script, otherwise download the release this script belongs to
    # (the setup script is also offered on its own on the release page).
    TAR_BALL=$(find "$SCRIPT_DIR" -maxdepth 2 -name "emir-code-*.tar.gz" | head -n 1)
    if [ -z "$TAR_BALL" ]; then
        TAR_BALL="$(mktemp -d)/emir-code-$APP_VERSION.tar.gz"
        echo "$MSG_DOWNLOADING $RELEASE_URL"
        if command -v curl >/dev/null 2>&1; then
            curl -fL --progress-bar -o "$TAR_BALL" "$RELEASE_URL" || rm -f "$TAR_BALL"
        elif command -v wget >/dev/null 2>&1; then
            wget -q --show-progress -O "$TAR_BALL" "$RELEASE_URL" || rm -f "$TAR_BALL"
        fi
    fi
    if [ -f "$TAR_BALL" ]; then
        tar -xzf "$TAR_BALL" -C "$INSTALL_DIR" --strip-components=1 || tar -xzf "$TAR_BALL" -C "$INSTALL_DIR"
    fi
fi

if [ ! -f "$INSTALL_DIR/$APP_EXEC_NAME" ]; then
    if [ "$GUI_MODE" = "zenity" ]; then
        zenity --error --title="$MSG_TITLE" --text="$MSG_NO_FILES" --width=450 2>/dev/null || true
    elif [ "$GUI_MODE" = "kdialog" ]; then
        kdialog --title "$MSG_TITLE" --error "$MSG_NO_FILES" 2>/dev/null || true
    fi
    echo -e "$MSG_NO_FILES" >&2
    exit 1
fi

chmod +x "$INSTALL_DIR/$APP_EXEC_NAME" 2>/dev/null || true

# Copy high-res icon
ICON_PATH="$INSTALL_DIR/icon.png"
if [ ! -f "$ICON_PATH" ]; then
    if [ -f "$SCRIPT_DIR/build/icon.png" ]; then
        cp "$SCRIPT_DIR/build/icon.png" "$ICON_PATH"
    elif [ -f "$SCRIPT_DIR/icon.png" ]; then
        cp "$SCRIPT_DIR/icon.png" "$ICON_PATH"
    fi
fi

# System icon folder registration
ICON_SYSTEM_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$ICON_SYSTEM_DIR"
if [ -f "$ICON_PATH" ]; then
    cp "$ICON_PATH" "$ICON_SYSTEM_DIR/emir-code.png"
fi

# ==============================================================================
# STEP 6: CREATE .DESKTOP ENTRY & SHORTCUTS
# ==============================================================================
DESKTOP_ENTRY="[Desktop Entry]
Name=Emir Code
GenericName=AI Native Coding Agent
Comment=$APP_COMMENT
Exec=\"$INSTALL_DIR/$APP_EXEC_NAME\" %U
Icon=$ICON_PATH
Terminal=false
Type=Application
Categories=Development;IDE;TextEditor;
StartupWMClass=Emir Code
MimeType=x-scheme-handler/emir-code;
Keywords=AI;Agent;Code;Ollama;Editor;IDE;
"

# 1. Applications Menu Launcher
if [ "$DO_MENU" -eq 1 ]; then
    MENU_DIR="$HOME/.local/share/applications"
    mkdir -p "$MENU_DIR"
    echo "$DESKTOP_ENTRY" > "$MENU_DIR/emir-code.desktop"
    chmod +x "$MENU_DIR/emir-code.desktop"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$MENU_DIR" 2>/dev/null || true
fi

# 2. Desktop Shortcut
if [ "$DO_DESKTOP" -eq 1 ]; then
    USER_DESKTOP_DIR="$HOME/Desktop"
    [ -d "$USER_DESKTOP_DIR" ] || USER_DESKTOP_DIR="$HOME/Masaüstü"
    if [ -d "$USER_DESKTOP_DIR" ]; then
        echo "$DESKTOP_ENTRY" > "$USER_DESKTOP_DIR/Emir Code.desktop"
        chmod +x "$USER_DESKTOP_DIR/Emir Code.desktop"
        # Trust desktop file on GNOME/KDE
        gio set "$USER_DESKTOP_DIR/Emir Code.desktop" "metadata::trusted" yes 2>/dev/null || true
    fi
fi

# 3. CLI Command in PATH (~/.local/bin)
if [ "$DO_CLI" -eq 1 ]; then
    LOCAL_BIN="$HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"
    ln -sf "$INSTALL_DIR/$APP_EXEC_NAME" "$LOCAL_BIN/$APP_EXEC_NAME"
fi

# ==============================================================================
# STEP 7: GENERATE UNINSTALL SCRIPT
# ==============================================================================
UNINSTALL_SCRIPT="$INSTALL_DIR/uninstall.sh"
cat << 'EOF' > "$UNINSTALL_SCRIPT"
#!/usr/bin/env bash
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -f "$HOME/.local/share/applications/emir-code.desktop"
rm -f "$HOME/Desktop/Emir Code.desktop"
rm -f "$HOME/Masaüstü/Emir Code.desktop"
rm -f "$HOME/.local/bin/emir-code"
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/emir-code.png"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "Emir Code desktop entries removed."
echo "To permanently delete the installation files, run: rm -rf \"$INSTALL_DIR\""
EOF
chmod +x "$UNINSTALL_SCRIPT"

# ==============================================================================
# STEP 8: COMPLETION & LAUNCH PROMPT
# ==============================================================================
printf -v FINAL_SUCCESS_MSG "$MSG_SUCCESS" "$INSTALL_DIR"

if [ "$GUI_MODE" = "zenity" ]; then
    if zenity --question --title="$MSG_TITLE" --text="$FINAL_SUCCESS_MSG" --width=450 --height=220 2>/dev/null; then
        nohup "$INSTALL_DIR/$APP_EXEC_NAME" >/dev/null 2>&1 &
    fi
elif [ "$GUI_MODE" = "kdialog" ]; then
    if kdialog --title "$MSG_TITLE" --yesno "$FINAL_SUCCESS_MSG" 2>/dev/null; then
        nohup "$INSTALL_DIR/$APP_EXEC_NAME" >/dev/null 2>&1 &
    fi
else
    echo -e "\n============================================================"
    echo -e "$FINAL_SUCCESS_MSG"
    echo "============================================================"
    read -rp "Başlat / Launch now? [Y/n]: " lchoice
    if [[ ! "$lchoice" =~ ^[Nn] ]]; then
        nohup "$INSTALL_DIR/$APP_EXEC_NAME" >/dev/null 2>&1 &
    fi
fi

exit 0
