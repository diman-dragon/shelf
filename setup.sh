#!/usr/bin/env bash
set -euo pipefail
npm install
mkdir -p www/lib
cp node_modules/idb-keyval/dist/umd.js www/lib/idb-keyval.js
cp node_modules/jsmediatags/dist/jsmediatags.min.js www/lib/jsmediatags.min.js
if [ ! -d android ]; then npx cap add android; fi
python3 patch_android.py
npx cap sync android
printf '
Готово. Сборка: cd android && ./gradlew assembleDebug
'
