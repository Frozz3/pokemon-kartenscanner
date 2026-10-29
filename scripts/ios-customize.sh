#!/usr/bin/env bash
# Adjusts the generated Xcode project: name, camera/photo permission texts, portrait only,
# app icon and launch screen (light and dark). Runs on the macOS build machine after `npx cap add ios`.
set -euo pipefail
APP=ios/App/App
PL="$APP/Info.plist"
PB=/usr/libexec/PlistBuddy
put() { "$PB" -c "Delete :$1" "$PL" >/dev/null 2>&1 || true; "$PB" -c "Add :$1 $2 $3" "$PL"; }
put CFBundleDisplayName string "Kartenscanner"
put NSCameraUsageDescription string "Die Kamera wird zum Scannen deiner Pokémon-Karten verwendet."
put NSPhotoLibraryUsageDescription string "Damit du Kartenfotos aus deiner Mediathek hinzufügen kannst."
put ITSAppUsesNonExemptEncryption bool false
"$PB" -c "Delete :UIRequiredDeviceCapabilities" "$PL" >/dev/null 2>&1 || true
"$PB" -c "Add :UIRequiredDeviceCapabilities array" "$PL"
"$PB" -c "Add :UIRequiredDeviceCapabilities:0 string arm64" "$PL"
"$PB" -c "Delete :UISupportedInterfaceOrientations" "$PL" >/dev/null 2>&1 || true
"$PB" -c "Add :UISupportedInterfaceOrientations array" "$PL"
"$PB" -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PL"

ICON="$APP/Assets.xcassets/AppIcon.appiconset"
rm -f "$ICON"/*.png
cp resources/icon.png "$ICON/icon.png"
cat > "$ICON/Contents.json" <<'JSON'
{ "images": [ { "filename": "icon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" } ],
  "info": { "author": "xcode", "version": 1 } }
JSON

SPL="$APP/Assets.xcassets/Splash.imageset"
rm -f "$SPL"/*.png
# The launch image is scaled to fill the screen; each scale has the icon sized so it shows at 100 pt.
cp resources/splash@2x.png "$SPL/splash-1.png"; cp resources/splash-dark@2x.png "$SPL/splash-dark-1.png"
for s in 2 3; do cp "resources/splash@${s}x.png" "$SPL/splash-$s.png"; cp "resources/splash-dark@${s}x.png" "$SPL/splash-dark-$s.png"; done
cat > "$SPL/Contents.json" <<'JSON'
{ "images": [
    { "idiom": "universal", "filename": "splash-1.png", "scale": "1x" },
    { "idiom": "universal", "filename": "splash-dark-1.png", "scale": "1x", "appearances": [ { "appearance": "luminosity", "value": "dark" } ] },
    { "idiom": "universal", "filename": "splash-2.png", "scale": "2x" },
    { "idiom": "universal", "filename": "splash-dark-2.png", "scale": "2x", "appearances": [ { "appearance": "luminosity", "value": "dark" } ] },
    { "idiom": "universal", "filename": "splash-3.png", "scale": "3x" },
    { "idiom": "universal", "filename": "splash-dark-3.png", "scale": "3x", "appearances": [ { "appearance": "luminosity", "value": "dark" } ] }
  ],
  "info": { "author": "xcode", "version": 1 } }
JSON
# Hide the scroll indicators: CSS can't reach the web view's own scroll bar on iOS.
SB="$APP/Base.lproj/Main.storyboard"
grep -q 'customClass="CAPBridgeViewController" customModule="Capacitor"' "$SB"
sed -i '' 's/customClass="CAPBridgeViewController" customModule="Capacitor"/customClass="MainViewController" customModule="App" customModuleProvider="target"/' "$SB"
cat >> "$APP/AppDelegate.swift" <<'SWIFT'

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        webView?.scrollView.showsVerticalScrollIndicator = false
        webView?.scrollView.showsHorizontalScrollIndicator = false
    }
}
SWIFT

echo "Xcode project customized."
