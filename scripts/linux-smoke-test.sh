#!/usr/bin/env bash
# ==============================================================================
# Emir Code - Linux release smoke test
# ==============================================================================
# Starts every Linux package of a release the way a user would (AppImage double-click,
# .deb install, .rpm contents, tar.gz, setup script) on a virtual display and checks that
# the main window really loads: the Chrome DevTools endpoint must list the app's index.html.
#
# Used by .github/workflows/release.yml; locally (Ubuntu/Debian):
#   sudo apt-get install -y xvfb x11-utils rpm2cpio cpio libfuse2t64
#   bash scripts/linux-smoke-test.sh release
# ==============================================================================
set -u

DIST="$(cd "${1:-release}" && pwd)"
PORT=9333
WORK="$(mktemp -d)"
FAILED=0
RESULTS=()

echo "apparmor_restrict_unprivileged_userns=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)"
ls -la "$DIST"

# One virtual display for all launches.
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 2

# launch_check <name> <required:1|0> <command...>
launch_check() {
  local name="$1" required="$2"
  shift 2
  local log="$WORK/$(echo "$name" | tr -c 'A-Za-z0-9' '_').log"
  echo "::group::$name"
  echo "\$ $*"
  setsid "$@" --remote-debugging-port=$PORT >"$log" 2>&1 &
  local pid=$!
  local ok=0
  for _ in $(seq 1 60); do
    sleep 1
    if curl -fs "http://127.0.0.1:$PORT/json/list" 2>/dev/null | grep -q '"url": *"file://[^"]*index\.html'; then
      ok=1
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
  done
  echo "--- processes:"
  pgrep -af 'emir-code' | cut -c1-200 | head -n 3
  echo "--- windows (name and WM_CLASS; desktop files use StartupWMClass=Emir Code):"
  xwininfo -root -tree 2>/dev/null | grep -i 'emir' | head -n 3
  kill -TERM -- "-$pid" 2>/dev/null
  sleep 2
  kill -KILL -- "-$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  echo "--- log (last 40 lines):"
  tail -n 40 "$log"
  echo "::endgroup::"
  if [ "$ok" = 1 ]; then
    RESULTS+=("PASS  $name")
  elif [ "$required" = 1 ]; then
    RESULTS+=("FAIL  $name")
    FAILED=1
    echo "::error title=Linux smoke test::$name did not open its main window (see its log group)"
  else
    RESULTS+=("info  $name: window did not open")
  fi
  sleep 1
}

# 1. AppImage, started directly (double-click)
APPIMAGE_FILE="$(ls "$DIST"/*.AppImage 2>/dev/null | head -n 1)"
if [ -n "$APPIMAGE_FILE" ]; then
  chmod +x "$APPIMAGE_FILE"
  launch_check "AppImage" 1 "$APPIMAGE_FILE"
else
  RESULTS+=("FAIL  AppImage: file missing"); FAILED=1
fi

# 2. tar.gz, extracted and started from its folder
TAR_FILE="$(ls "$DIST"/emir-code-*.tar.gz 2>/dev/null | head -n 1)"
if [ -n "$TAR_FILE" ]; then
  mkdir -p "$WORK/tar"
  tar -xzf "$TAR_FILE" -C "$WORK/tar" --strip-components=1
  launch_check "tar.gz" 1 "$WORK/tar/emir-code"
  # Without the launcher script the Electron binary needs a working Chromium sandbox;
  # shown for information (it fails on Ubuntu 24.04, which is what the launcher handles).
  launch_check "tar.gz binary without launcher (info)" 0 "$WORK/tar/emir-code-bin"
else
  RESULTS+=("FAIL  tar.gz: file missing"); FAILED=1
fi

# 3. .deb, installed with apt and started as the user would (/usr/bin/emir-code)
DEB_FILE="$(ls "$DIST"/*.deb 2>/dev/null | head -n 1)"
if [ -n "$DEB_FILE" ]; then
  if sudo apt-get install -y "$DEB_FILE" >"$WORK/deb-install.log" 2>&1; then
    launch_check "deb (/usr/bin/emir-code)" 1 emir-code
    sudo apt-get remove -y emir-code >/dev/null 2>&1 || true
  else
    tail -n 30 "$WORK/deb-install.log"
    RESULTS+=("FAIL  deb: apt install failed"); FAILED=1
  fi
else
  RESULTS+=("FAIL  deb: file missing"); FAILED=1
fi

# 4. .rpm contents (installing rpm packages is not possible on Ubuntu)
RPM_FILE="$(ls "$DIST"/*.rpm 2>/dev/null | head -n 1)"
if [ -n "$RPM_FILE" ]; then
  mkdir -p "$WORK/rpm"
  (cd "$WORK/rpm" && rpm2cpio "$RPM_FILE" | cpio -idm --quiet)
  RPM_EXE="$(find "$WORK/rpm/opt" -maxdepth 2 -name emir-code -type f | head -n 1)"
  if [ -n "$RPM_EXE" ]; then
    launch_check "rpm contents" 1 "$RPM_EXE"
  else
    RESULTS+=("FAIL  rpm: emir-code not found in the package"); FAILED=1
  fi
else
  RESULTS+=("FAIL  rpm: file missing"); FAILED=1
fi

# 5. Setup script in terminal mode (continue, default folder, no Ollama, do not launch)
SETUP_FILE="$DIST/emir-code-setup-linux.sh"
if [ -f "$SETUP_FILE" ]; then
  if printf 'y\n\nn\nn\n' | env -u DISPLAY -u WAYLAND_DISPLAY bash "$SETUP_FILE" >"$WORK/setup.log" 2>&1; then
    launch_check "setup script install (~/.local/share/emir-code)" 1 "$HOME/.local/share/emir-code/emir-code"
  else
    tail -n 30 "$WORK/setup.log"
    RESULTS+=("FAIL  setup script exited with an error"); FAILED=1
  fi
else
  RESULTS+=("FAIL  setup script: file missing"); FAILED=1
fi

kill "$XVFB_PID" 2>/dev/null

echo
echo "================ Linux smoke test ================"
printf '%s\n' "${RESULTS[@]}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Linux smoke test"
    echo '```'
    printf '%s\n' "${RESULTS[@]}"
    echo '```'
  } >>"$GITHUB_STEP_SUMMARY"
fi
exit "$FAILED"
