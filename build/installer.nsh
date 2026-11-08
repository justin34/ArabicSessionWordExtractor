; The Installer's own additions to electron-builder's NSIS scripts (GLOSSARY: Installer).
;
; Uninstalling keeps the learner's data (recordings, Vocabulary, settings, in
; %APPDATA%\Arabic Session Word Extractor) unless they tick "Also delete my recordings and
; vocabulary" on the page after the uninstaller's welcome page. It is unticked by default.
; An update runs the old uninstaller silently, with no pages, so an update never deletes data.

!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var deleteLearnerData
  Var deleteLearnerDataBox

  ; Inserted where electron-builder declares the uninstaller's pages, once MUI is loaded.
  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.LearnerDataPage un.LearnerDataPageLeave

    Function un.LearnerDataPage
      !insertmacro MUI_HEADER_TEXT "Your recordings and vocabulary" "Choose whether to keep them."
      nsDialogs::Create 1018
      Pop $0
      ${if} $0 == error
        Abort
      ${endif}
      ${NSD_CreateLabel} 0 0 100% 36u "Your Sessions' recordings, your Vocabulary and your settings are kept, so they are still there if you install ${PRODUCT_NAME} again."
      Pop $0
      ${NSD_CreateCheckbox} 0 44u 100% 12u "Also delete my recordings and vocabulary"
      Pop $deleteLearnerDataBox
      ${NSD_Uncheck} $deleteLearnerDataBox
      nsDialogs::Show
    FunctionEnd

    Function un.LearnerDataPageLeave
      ${NSD_GetState} $deleteLearnerDataBox $deleteLearnerData
    FunctionEnd
  !macroend

  !macro customUnInstall
    ${ifNot} ${isUpdated}
      ${if} $deleteLearnerData == ${BST_CHECKED}
        ; The app's data folder is always the current user's, as in electron-builder's own
        ; deleteAppDataOnUninstall; the context is put back for the rest of the uninstall.
        ${if} $installMode == "all"
          SetShellVarContext current
        ${endif}
        RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
        ${if} $installMode == "all"
          SetShellVarContext all
        ${endif}
      ${endif}
    ${endif}
  !macroend
!endif
