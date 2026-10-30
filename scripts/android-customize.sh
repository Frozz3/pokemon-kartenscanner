#!/usr/bin/env bash
# Adjusts the generated Android project: camera permission, portrait only, version from the build
# number, launcher icons, launch screen and system bar colours (light and dark).
# Runs on the build machine after `npx cap add android`. Usage: scripts/android-customize.sh <buildNumber>
set -euo pipefail
BUILD="${1:-1}"
MAIN=android/app/src/main
RES="$MAIN/res"

python3 - "$MAIN/AndroidManifest.xml" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
perm = '<uses-permission android:name="android.permission.INTERNET" />'
assert perm in s, "INTERNET permission line not found"
if "android.permission.CAMERA" not in s:
    s = s.replace(perm, perm + '\n    <uses-permission android:name="android.permission.CAMERA" />'
                          '\n    <uses-feature android:name="android.hardware.camera" android:required="false" />')
act = 'android:name=".MainActivity"'
assert act in s, "MainActivity not found"
if "screenOrientation" not in s:
    s = s.replace(act, act + '\n            android:screenOrientation="portrait"')
open(p, "w", encoding="utf-8").write(s)
PY

# Version: versionCode must grow with every build, or Android refuses the update.
sed -i -E "s/versionCode [0-9]+/versionCode ${BUILD}/; s/versionName \"[^\"]*\"/versionName \"1.0.${BUILD}\"/" android/app/build.gradle
grep -q "versionCode ${BUILD}" android/app/build.gradle

# Launcher icons (adaptive: yellow background + artwork foreground; legacy square and round)
cp -R resources/android/res/. "$RES/"
cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFCB05</color>
</resources>
XML

# Colours of the launch screen and the system bars on older Android versions (light / dark)
mkdir -p "$RES/values-night"
for pair in "values:#F6F4EF:#14162B" "values-night:#0B0D1A:#FFCB05"; do
  IFS=: read -r dir bg accent <<<"$pair"
  cat > "$RES/$dir/colors.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">${bg}</color>
    <color name="colorPrimaryDark">${bg}</color>
    <color name="colorAccent">${accent}</color>
    <color name="ks_splash_bg">${bg}</color>
</resources>
XML
done

python3 - "$RES/values/styles.xml" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = '<item name="android:background">@drawable/splash</item>'
assert old in s, "launch theme not found"
s = s.replace(old, '<item name="android:background">@color/ks_splash_bg</item>\n'
                   '        <item name="windowSplashScreenBackground">@color/ks_splash_bg</item>\n'
                   '        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>\n'
                   '        <item name="windowSplashScreenIconBackgroundColor">@color/ic_launcher_background</item>\n'
                   '        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>')
s = s.replace('<item name="android:background">@null</item>', '<item name="android:background">@color/ks_splash_bg</item>')
open(p, "w", encoding="utf-8").write(s)
PY
echo "Android project customized (versionCode ${BUILD})."
