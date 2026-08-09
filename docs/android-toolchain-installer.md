# Android Toolchain Installer

The Android toolchain is installed during first-run setup, not pre-bundled in the application image.

## Installer Scope

- Installs OS build prerequisites, Git, Python 3, archive tools, image tools, Chromium, and JDK.
- Installs Android SDK command-line tools, platform tools, build tools, emulator, and a Google APIs
  x86_64 system image.
- Resolves Gradle at install time from the current Gradle services metadata.
- Creates a debug keystore for local builds.
- Creates an AVD for later phone emulator verification.
- Persists a `toolchain_install_runs` record for every attempt.
- Creates a `toolchain_snapshots` record only after install and verification pass.

## Runtime Requirements

The installer runs in a root-capable container because first-run setup installs operating-system
packages. If the app process is not root-capable, the installer records a failed run and leaves Build
Environment not ready. Tool paths are exported through `ANDROID_HOME`, `ANDROID_SDK_ROOT`,
`ANDROID_AVD_HOME`, and `PATH`.

## Snapshot Policy

- New projects receive the latest verified toolchain snapshot at project creation time.
- Existing projects keep their assigned snapshot unless the user explicitly requests an upgrade.
- Active project toolchains must never be upgraded mid-run.
