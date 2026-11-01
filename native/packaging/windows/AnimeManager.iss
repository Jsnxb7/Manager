; Source-only installer recipe. It has NOT been compiled or verified on a device.
#define AppVersion "1.0.0"
#define ReleaseDir "..\..\release\windows"
#if !FileExists(ReleaseDir + "\AnimeManager.exe")
  #error Stage the native release directory before packaging. No application binary is included in this repository.
#endif
#if !FileExists(ReleaseDir + "\Bundle\index.windows.bundle")
  #error The release must contain its offline JavaScript bundle.
#endif
#if !FileExists(ReleaseDir + "\redist\VC_redist.x64.exe")
  #error Include the licensed Microsoft VC++ x64 redistributable in the staged release.
#endif
[Setup]
AppId={{B1B7A38D-CA80-4DCB-88AB-77B28DEBF460}
AppName=Anime Manager
AppVersion={#AppVersion}
DefaultDirName={autopf}\Anime Manager
DefaultGroupName=Anime Manager
OutputDir=..\..\release\installers
OutputBaseFilename=AnimeManager-Setup-{#AppVersion}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\AnimeManager.exe
[Files]
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,*.map,*.log,*.json.bak"
[Icons]
Name: "{group}\Anime Manager"; Filename: "{app}\AnimeManager.exe"
[Run]
Filename: "{app}\redist\VC_redist.x64.exe"; Parameters: "/install /quiet /norestart"; Flags: waituntilterminated
Filename: "{app}\AnimeManager.exe"; Description: "Open Anime Manager"; Flags: nowait postinstall skipifsilent
