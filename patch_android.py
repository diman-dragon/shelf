from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
main = ROOT / 'android' / 'app' / 'src' / 'main'
java = main / 'java' / 'com' / 'shelf' / 'player'
java.mkdir(parents=True, exist_ok=True)

for src in (ROOT / 'native' / 'java').glob('*.java'):
    shutil.copy2(src, java / src.name)
shutil.copytree(ROOT / 'native' / 'res', main / 'res', dirs_exist_ok=True)

manifest = main / 'AndroidManifest.xml'
m = manifest.read_text(encoding='utf-8')

perms = [
    'FOREGROUND_SERVICE',
    'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'POST_NOTIFICATIONS',
    'WAKE_LOCK',
]
for p in perms:
    line = f'<uses-permission android:name="android.permission.{p}"/>'
    if line not in m:
        m = m.replace('<application', line + '\n<application', 1)

components = '''
        <service android:name=".PlayerService" android:exported="false" android:foregroundServiceType="mediaPlayback"/>
        <receiver android:name=".PlayerWidget" android:exported="false">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info"/>
        </receiver>
'''
if 'android:name=".PlayerService"' not in m:
    m = m.replace('</application>', components + '    </application>', 1)
manifest.write_text(m, encoding='utf-8')
