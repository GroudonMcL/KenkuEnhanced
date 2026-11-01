; Inno Setup script for KenkuEnhanced  (https://jrsoftware.org/isinfo.php)
; Built automatically by .github/workflows/release.yml - you don't need to run it.
; To build by hand on Windows:
;   iscc /DAppVersion=0.2.0 /DSourceDir=..\build\KenkuEnhanced installer\KenkuEnhanced.iss
;
; Installs for the current user only (no admin rights needed) into
; %LOCALAPPDATA%\Programs\KenkuEnhanced, so the dashboard can update itself later.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\build\KenkuEnhanced"
#endif

[Setup]
; Never change AppId: Windows uses it to recognise the app for upgrades/uninstall.
AppId={{6F3B1C2A-8D4E-4F7B-9A61-2C5E7D9B4A10}
AppName=KenkuEnhanced
AppVersion={#AppVersion}
AppVerName=KenkuEnhanced {#AppVersion}
AppPublisher=GroudonMcL
AppPublisherURL=https://github.com/GroudonMcL/KenkuEnhanced
AppSupportURL=https://github.com/GroudonMcL/KenkuEnhanced/issues
AppUpdatesURL=https://github.com/GroudonMcL/KenkuEnhanced/releases
DefaultDirName={localappdata}\Programs\KenkuEnhanced
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
LicenseFile={#SourceDir}\LICENSE
OutputDir=..\dist
OutputBaseFilename=KenkuEnhanced-Setup-v{#AppVersion}
UninstallDisplayIcon={app}\node\node.exe
UninstallDisplayName=KenkuEnhanced
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The helper must be closed while files are replaced.
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "startup"; Description: "Start the helper automatically when I sign in to Windows"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
; Everything from the release folder. Your own files (config.json, data\, downloads\)
; are created later by the app, so upgrades and uninstalls never touch them.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\KenkuEnhanced"; Filename: "{app}\Start KenkuEnhanced.bat"; WorkingDir: "{app}"; IconFilename: "{app}\node\node.exe"; Comment: "Start the KenkuEnhanced helper, then open http://localhost:4000 in Kenku"
Name: "{autoprograms}\KenkuEnhanced folder"; Filename: "{app}"; Comment: "Settings, scenes and downloaded sounds"
Name: "{autodesktop}\KenkuEnhanced"; Filename: "{app}\Start KenkuEnhanced.bat"; WorkingDir: "{app}"; IconFilename: "{app}\node\node.exe"; Tasks: desktopicon
Name: "{userstartup}\KenkuEnhanced"; Filename: "{app}\Start KenkuEnhanced.bat"; WorkingDir: "{app}"; IconFilename: "{app}\node\node.exe"; Flags: runminimized; Tasks: startup

[Run]
Filename: "{app}\Start KenkuEnhanced.bat"; WorkingDir: "{app}"; Description: "Start KenkuEnhanced now"; Flags: postinstall nowait skipifsilent shellexec

[UninstallDelete]
; Files the app makes itself that aren't yours: update downloads/backups and the picture model.
Type: filesandordirs; Name: "{app}\update"
Type: filesandordirs; Name: "{app}\data\models"
Type: files; Name: "{app}\data\soundpads.json"

[Messages]
FinishedLabel=KenkuEnhanced is installed.%n%nStart it, then in Kenku FM open a new browser tab and go to http://localhost:4000.%n%n(Turn on Kenku FM > Settings > Remote first.)
