# Release packaging (configuration only)

No native build, APK assembly, EXE installer compilation, device launch or external build CI was run. Commands below describe future user-authorized release work; they are not validation evidence.

## Windows x64

- Host source: `windows/AnimeManager/AnimeManager.vcxproj` (the solution also contains an optional MSIX project), RNW 0.85 Fabric; Visual Studio 2026 and .NET 10; installed SDK 10.0.26100.0 pinned in the project.
- Release sets `UseBundle=true`, `UseDevBundle=false`, `WindowsAppSDKSelfContained=true` and disables development support in host code. Confirm native dependency output and offline bundle placement during future compilation.
- Stage all native output dependencies beside AnimeManager.exe in `native/release/windows/`, including `Bundle/index.windows.bundle`, bundle assets and Windows App SDK dependencies. A raw EXE copied alone is insufficient.
- Include Microsoft's licensed x64 VC++ redistributable at `release/windows/redist/VC_redist.x64.exe`. Check redistribution licenses for all native runtime components. Review native MFPlay codec availability on target Windows editions, including Windows N media-component requirements.
- Use Inno Setup 6 with `packaging/windows/AnimeManager.iss` to produce a single downloadable installer EXE. The installed app includes DLLs/assets. There is no promise of a single standalone executable file.
- Signing the installer/EXE requires the publisher's signing certificate or chosen signing service; no certificate/private key is included.

## Android phone/tablet

- SDK 36, Build-Tools 36.0.0, NDK 27.1.12297006, JDK 17; exact project versions in `android/build.gradle`. The Gradle wrapper manages Gradle, not a global installation.
- Release embeds JS/resources through the React Native Gradle plugin, enables resource shrinking/minification, and uses the release signing configuration. No Metro server or Node/Python installation is needed on the phone.
- Configure `ANIME_RELEASE_STORE_FILE`, `ANIME_RELEASE_STORE_PASSWORD`, `ANIME_RELEASE_KEY_ALIAS`, `ANIME_RELEASE_KEY_PASSWORD` in the build shell/secret store. The release configuration fails if these are absent and never silently signs release with the template debug key.
- Keep signing keys outside the repository and back them up securely for updates. No keys were generated here.
- The configured universal APK contains arm64-v8a and x86_64 native code; modern 64-bit phones/tablets are the first target. Add armeabi-v7a only if a required 32-bit device is identified. Minimum platform API is determined by the pinned RN template.
- After explicit compilation authorization, use the release APK task (not the app-bundle-only task) for direct installation. Validate signatures, installation and fully offline startup on physical devices before distribution.

## Assets, data and final release gates

Only `native/src` and app-owned assets belong in the bundle. Legacy root catalogs, personal media/covers, exports, device paths, caches, logs, .venv and node_modules contents unrelated to runtime must not be manually copied into release assets. Native generated launcher icons retain required PNG/ICO formats; user covers use WebP on Android with codec-aware original-format fallback on Windows. No decorative video is bundled, so no WebM background decoder overhead is introduced.

App open-with, native permissions, embedded/audio codecs, fullscreen, PiP, accessibility, resize/rotation, signed installation and performance are device verification gates. Static checks cannot validate those. The initial UI uses platform system typography to avoid an unlicensed/unregistered font bundle; revisit Source Sans 3 only with proper font registration and license assets.
