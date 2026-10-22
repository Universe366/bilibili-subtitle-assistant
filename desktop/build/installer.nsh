; 自定义卸载页：让用户选择是否同时删除本地数据。
!include "nsDialogs.nsh"

!macro customUnWelcomePage
  Var DeleteAppData
  Function un.bsubDeleteDataPageShow
    !insertmacro MUI_HEADER_TEXT "卸载 B站字幕助手" "选择是否保留本地数据"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 14u "同时删除本地数据（设置、字幕库、登录状态、缓存、日志）"
    Pop $1
    ${NSD_Uncheck} $1

    ${NSD_CreateLabel} 0 22u 100% 48u "不勾选：只删除程序文件和快捷方式，保留数据目录 $APPDATA\bsub-desktop。$\r$\n勾选：同时删除上述数据目录和更新缓存，无法恢复。"
    Pop $2

    nsDialogs::Show
  FunctionEnd

  Function un.bsubDeleteDataPageLeave
    ${NSD_GetState} $1 $DeleteAppData
  FunctionEnd

  UninstPage custom un.bsubDeleteDataPageShow un.bsubDeleteDataPageLeave
!macroend

!macro customUnInstall
  ${If} $DeleteAppData == "1"
    RMDir /r "$APPDATA\bsub-desktop"
    RMDir /r "$LOCALAPPDATA\bsub-desktop-updater"
  ${EndIf}
!macroend
