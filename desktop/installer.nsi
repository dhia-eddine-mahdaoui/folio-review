Unicode true
!include "MUI2.nsh"
Name "Folio Review"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\FolioReview"
RequestExecutionLevel user
SetCompressor lzma
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Folio Review" main
  SectionIn RO
  SetShellVarContext current
  IfFileExists "$INSTDIR\app\stop-service.ps1" 0 +2
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\app\stop-service.ps1"'
  SetOutPath "$INSTDIR\app"
  File /r "${PAYLOAD}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Folio Review.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\app\launch.vbs"' "$INSTDIR\app\folio.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FolioReview" "DisplayName" "Folio Review"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FolioReview" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FolioReview" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FolioReview" "DisplayIcon" "$INSTDIR\app\folio.ico"
SectionEnd
Section "AI skills for detected agents" skills
  nsExec::ExecToLog '"$INSTDIR\app\node.exe" "$INSTDIR\app\desktop\agents.mjs" install'
  Pop $0
  StrCmp $0 "0" +3
  SetErrorLevel 1
  MessageBox MB_OK|MB_ICONEXCLAMATION "Folio installed, but some agent skills could not be added. Run setup again after closing your agent." /SD IDOK
SectionEnd
Section "Desktop shortcut"
  CreateShortcut "$DESKTOP\Folio Review.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\app\launch.vbs"' "$INSTDIR\app\folio.ico"
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\app\stop-service.ps1"'
  nsExec::ExecToLog '"$INSTDIR\app\node.exe" "$INSTDIR\app\desktop\agents.mjs" remove'
  Pop $0
  StrCmp $0 "0" +3
  SetErrorLevel 1
  Abort "Close your agent and retry uninstall to remove Folio skills."
  Delete "$DESKTOP\Folio Review.lnk"
  Delete "$SMPROGRAMS\Folio Review.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FolioReview"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
