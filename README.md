# Shelf 2.0

Local audiobook and music library for Android, designed from the supplied UI reference.

## Windows setup

Use PowerShell from the project directory. WSL is not required.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
.\build.ps1
```

Or double-click `setup.cmd`, then `build.cmd`.

The setup script creates the Capacitor Android project in `android\` if it does not exist, installs the native Shelf code, and runs Capacitor sync.

The debug APK is created at:

`android\app\build\outputs\apk\debug\app-debug.apk`

## Requirements

- Windows 10/11
- Node.js 20+
- Python 3+
- Java JDK compatible with the generated Capacitor Android project
- Android SDK / build tools available to Gradle
- Internet access for the first `npm install` and Gradle dependency resolution
