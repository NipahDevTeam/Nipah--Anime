#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PATH="$HOME/go/bin:$PATH"

WAILS_BIN="${WAILS_BIN:-$(command -v wails || true)}"
if [[ -z "${WAILS_BIN}" ]]; then
  echo "[Linux] Wails CLI not found in PATH" >&2
  exit 1
fi

VERSION="$(grep -Po '(?<=\"productVersion\": \")[^\"]+' wails.json | head -n1)"
if [[ -z "${VERSION}" ]]; then
  echo "[Linux] Could not determine version from wails.json" >&2
  exit 1
fi

TOOLS_DIR="${HOME}/.cache/nipah-linux-tools"
APPDIR="${ROOT_DIR}/build/appimage/AppDir"
OUTPUT_NAME="Nipah-Anime-${VERSION}-x86_64.AppImage"

mkdir -p "${TOOLS_DIR}" "${ROOT_DIR}/build/appimage"

if [[ ! -x "${TOOLS_DIR}/linuxdeploy-x86_64.AppImage" ]]; then
  echo "[Linux] Downloading linuxdeploy"
  curl -L \
    -o "${TOOLS_DIR}/linuxdeploy-x86_64.AppImage" \
    "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage"
  chmod +x "${TOOLS_DIR}/linuxdeploy-x86_64.AppImage"
fi

copy_dep() {
  local dep_path="$1"
  local relative="${dep_path#/}"
  local target="${APPDIR}/usr/lib/${relative}"
  mkdir -p "$(dirname "${target}")"
  cp -L "${dep_path}" "${target}"
}

copy_binary_and_deps() {
  local binary_path="$1"
  local target_path="$2"

  mkdir -p "$(dirname "${target_path}")"
  cp -L "${binary_path}" "${target_path}"

  while IFS= read -r dep_path; do
    [[ -n "${dep_path}" ]] || continue
    copy_dep "${dep_path}"
  done < <(
    ldd "${binary_path}" | awk '
      $2 == "=>" && $3 ~ /^\// { print $3 }
      $1 ~ /^\// { print $1 }
    ' | sort -u
  )
}

copy_optional_dir() {
  local source_dir="$1"
  local target_dir="$2"
  if [[ -d "${source_dir}" ]]; then
    mkdir -p "${target_dir}"
    cp -a "${source_dir}/." "${target_dir}/"
  fi
}

echo "[Linux] Building frontend"
npm --prefix frontend install
npm --prefix frontend run build

echo "[Linux] Building Wails app"
"${WAILS_BIN}" build -clean -platform linux/amd64 -tags webkit2_41

APP_BINARY="${ROOT_DIR}/build/bin/Nipah! Anime"
APP_ICON="${ROOT_DIR}/build/appicon.png"
if [[ ! -f "${APP_ICON}" ]]; then
  APP_ICON="${ROOT_DIR}/appimg.png"
fi
MPV_BINARY="$(command -v mpv || true)"
if [[ ! -x "${APP_BINARY}" ]]; then
  echo "[Linux] Built app binary not found: ${APP_BINARY}" >&2
  exit 1
fi
if [[ ! -f "${APP_ICON}" ]]; then
  echo "[Linux] Tracked app icon not found: ${APP_ICON}" >&2
  exit 1
fi
if [[ -z "${MPV_BINARY}" ]]; then
  echo "[Linux] mpv is required to bundle the portable AppImage" >&2
  exit 1
fi

echo "[Linux] Preparing AppDir"
rm -rf "${APPDIR}"
mkdir -p \
  "${APPDIR}/usr/bin" \
  "${APPDIR}/usr/lib" \
  "${APPDIR}/usr/share/applications" \
  "${APPDIR}/usr/share/icons/hicolor/512x512/apps"

copy_binary_and_deps "${APP_BINARY}" "${APPDIR}/usr/bin/nipah-anime-bin"
copy_binary_and_deps "${MPV_BINARY}" "${APPDIR}/usr/bin/mpv"

copy_optional_dir "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1" "${APPDIR}/usr/lib/webkit2gtk-4.1"
copy_optional_dir "/usr/libexec/webkit2gtk-4.1" "${APPDIR}/usr/libexec/webkit2gtk-4.1"
copy_optional_dir "/usr/lib/x86_64-linux-gnu/gio/modules" "${APPDIR}/usr/lib/gio/modules"
copy_optional_dir "/usr/share/glib-2.0/schemas" "${APPDIR}/usr/share/glib-2.0/schemas"

cat > "${APPDIR}/AppRun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LD_LIBRARY_PATH="${APPDIR}/usr/lib:${LD_LIBRARY_PATH:-}"
export PATH="${APPDIR}/usr/bin:${PATH}"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
exec "${APPDIR}/usr/bin/nipah-anime-bin" "$@"
EOF
chmod +x "${APPDIR}/AppRun"
ln -sf "nipah-anime-bin" "${APPDIR}/usr/bin/nipah-anime"

cp "${APP_ICON}" "${APPDIR}/usr/share/icons/hicolor/512x512/apps/nipah-anime.png"
cp "${ROOT_DIR}/packaging/linux/nipah-anime-appimage.desktop" "${APPDIR}/usr/share/applications/nipah-anime.desktop"

echo "[Linux] Packaging AppImage"
ARCH=x86_64 \
LDAI_OUTPUT="${OUTPUT_NAME}" \
"${TOOLS_DIR}/linuxdeploy-x86_64.AppImage" --appimage-extract-and-run \
  --appdir "${APPDIR}" \
  --desktop-file "${APPDIR}/usr/share/applications/nipah-anime.desktop" \
  --icon-file "${APPDIR}/usr/share/icons/hicolor/512x512/apps/nipah-anime.png" \
  --executable "${APPDIR}/usr/bin/nipah-anime-bin" \
  --output appimage

mv -f "${ROOT_DIR}/${OUTPUT_NAME}" "${ROOT_DIR}/build/bin/${OUTPUT_NAME}"
sed 's/\r$//' packaging/arch/PKGBUILD > build/bin/PKGBUILD
echo "[Linux] AppImage ready at build/bin/${OUTPUT_NAME}"
