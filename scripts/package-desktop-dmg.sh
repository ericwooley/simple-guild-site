#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/desktop"
OUT_DIR="${OUT_DIR:-${DESKTOP_DIR}/build/release}"
APP_VERSION="${APP_VERSION:-0.1.0-dev}"
GIT_COMMIT="${GIT_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo dev)}"
UPDATE_REPO="${UPDATE_REPO:-ericwooley/simple-guild-site}"
UNIVERSAL="${UNIVERSAL:-1}"

mkdir -p "$OUT_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LDFLAGS="-s -w -X main.AppVersion=${APP_VERSION} -X main.GitCommit=${GIT_COMMIT} -X main.UpdateRepo=${UPDATE_REPO}"

echo "Building HelpingHand desktop v${APP_VERSION} (${GIT_COMMIT})..."
cd "$DESKTOP_DIR"

if [ "$UNIVERSAL" = "1" ]; then
  CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 \
    CGO_CFLAGS="-arch arm64" \
    CGO_LDFLAGS="-arch arm64 -framework UniformTypeIdentifiers" \
    go build -tags desktop,production -ldflags "$LDFLAGS" -o "${TMP_DIR}/HelpingHand-arm64" .

  CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 \
    CGO_CFLAGS="-arch x86_64" \
    CGO_LDFLAGS="-arch x86_64 -framework UniformTypeIdentifiers" \
    go build -tags desktop,production -ldflags "$LDFLAGS" -o "${TMP_DIR}/HelpingHand-amd64" .

  lipo -create -output "${TMP_DIR}/HelpingHand" "${TMP_DIR}/HelpingHand-arm64" "${TMP_DIR}/HelpingHand-amd64"
  DMG_ARCH="universal"
else
  ARCH="$(uname -m)"
  CGO_ENABLED=1 CGO_LDFLAGS="-framework UniformTypeIdentifiers" \
    go build -tags desktop,production -ldflags "$LDFLAGS" -o "${TMP_DIR}/HelpingHand" .
  DMG_ARCH="$ARCH"
fi

APP_BUNDLE="${TMP_DIR}/stage/HelpingHand.app"
mkdir -p "${APP_BUNDLE}/Contents/MacOS" "${APP_BUNDLE}/Contents/Resources"
cp "${TMP_DIR}/HelpingHand" "${APP_BUNDLE}/Contents/MacOS/HelpingHand"
chmod +x "${APP_BUNDLE}/Contents/MacOS/HelpingHand"

# Generate AppIcon.icns from public/icon-512.png if available.
ICON_SRC="${ROOT_DIR}/public/icon-512.png"
if [ -f "$ICON_SRC" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
  ICONSET="${TMP_DIR}/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "${ICONSET}/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    if [ "$double" -le 512 ]; then
      sips -z "$double" "$double" "$ICON_SRC" --out "${ICONSET}/icon_${size}x${size}@2x.png" >/dev/null
    fi
  done
  iconutil -c icns "$ICONSET" -o "${APP_BUNDLE}/Contents/Resources/AppIcon.icns"
fi

cat > "${APP_BUNDLE}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>Band of the Helping Hand</string>
	<key>CFBundleExecutable</key>
	<string>HelpingHand</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>com.helpinghand.sync</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>HelpingHand</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${APP_VERSION}</string>
	<key>CFBundleVersion</key>
	<string>${APP_VERSION}</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "${APP_BUNDLE}"

ln -s /Applications "${TMP_DIR}/stage/Applications"

DMG_NAME="HelpingHand-macOS-${DMG_ARCH}.dmg"
DMG_PATH="${OUT_DIR}/${DMG_NAME}"
rm -f "$DMG_PATH"

hdiutil create \
  -volname "Band of the Helping Hand" \
  -srcfolder "${TMP_DIR}/stage" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

(
  cd "$OUT_DIR"
  shasum -a 256 "$DMG_NAME" > SHA256SUMS.txt
)

echo "Created ${DMG_PATH}"
cat "${OUT_DIR}/SHA256SUMS.txt"
