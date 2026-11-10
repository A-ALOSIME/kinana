; NSIS upgrade hooks for Kinana:
; Safely removes prior Windows installations registered under legacy Arabic product names
; while strictly preserving user vault data (%APPDATA%\com.kinana.vault) and credential store keys.

!macro _KinanaRemoveLegacyInstall LEGACY_NAME HAD_DESKTOP_FLAG
  StrCpy $R8 ""
  ReadRegStr $R8 SHCTX "Software\${MANUFACTURER}\${LEGACY_NAME}" ""
  ${If} $R8 == ""
    IfFileExists "$LOCALAPPDATA\${LEGACY_NAME}\${MAINBINARYNAME}.exe" 0 +2
      StrCpy $R8 "$LOCALAPPDATA\${LEGACY_NAME}"
  ${EndIf}

  ${If} $R8 != ""
  ${AndIf} $R8 != "$INSTDIR"
    ; Close legacy running instance cleanly via RestartManager before uninstalling it.
    IfFileExists "$R8\${MAINBINARYNAME}.exe" 0 +2
      !insertmacro CheckIfAppIsRunning "$R8\${MAINBINARYNAME}.exe" "Kinana"

    ; Run old uninstaller silently with /UPDATE so app data under $APPDATA\com.kinana.vault is never touched.
    IfFileExists "$R8\uninstall.exe" 0 _skip_uninst_${HAD_DESKTOP_FLAG}
      ExecWait '"$R8\uninstall.exe" /S /UPDATE _?=$R8' $R7
    _skip_uninst_${HAD_DESKTOP_FLAG}:

    Delete "$R8\${MAINBINARYNAME}.exe"
    Delete "$R8\uninstall.exe"
    RMDir "$R8"
  ${EndIf}

  ; Migrate and remove legacy Desktop shortcut while remembering user preference.
  IfFileExists "$DESKTOP\${LEGACY_NAME}.lnk" 0 _no_desktop_${HAD_DESKTOP_FLAG}
    WriteRegStr HKCU "${MANUPRODUCTKEY}" "MigrateLegacyDesktopShortcut" "1"
    !insertmacro UnpinShortcut "$DESKTOP\${LEGACY_NAME}.lnk"
    Delete "$DESKTOP\${LEGACY_NAME}.lnk"
  _no_desktop_${HAD_DESKTOP_FLAG}:

  ; Clean up legacy Start Menu shortcuts and optional legacy Start Menu folder.
  IfFileExists "$SMPROGRAMS\${LEGACY_NAME}.lnk" 0 _no_sm_root_${HAD_DESKTOP_FLAG}
    !insertmacro UnpinShortcut "$SMPROGRAMS\${LEGACY_NAME}.lnk"
    Delete "$SMPROGRAMS\${LEGACY_NAME}.lnk"
  _no_sm_root_${HAD_DESKTOP_FLAG}:

  IfFileExists "$SMPROGRAMS\${LEGACY_NAME}\${LEGACY_NAME}.lnk" 0 _no_sm_sub_${HAD_DESKTOP_FLAG}
    !insertmacro UnpinShortcut "$SMPROGRAMS\${LEGACY_NAME}\${LEGACY_NAME}.lnk"
    Delete "$SMPROGRAMS\${LEGACY_NAME}\${LEGACY_NAME}.lnk"
    RMDir "$SMPROGRAMS\${LEGACY_NAME}"
  _no_sm_sub_${HAD_DESKTOP_FLAG}:

  ; Remove legacy Add/Remove Programs and manufacturer/product registry entries.
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_NAME}"
  DeleteRegKey SHCTX "Software\${MANUFACTURER}\${LEGACY_NAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${LEGACY_NAME}"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _KinanaRemoveLegacyInstall "كنانة" "legacy_plain"
  !insertmacro _KinanaRemoveLegacyInstall "كِنانة" "legacy_diacritic"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R8 HKCU "${MANUPRODUCTKEY}" "MigrateLegacyDesktopShortcut"
  ${If} $R8 == "1"
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "MigrateLegacyDesktopShortcut"
    ${If} $NoShortcutMode <> 1
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend
