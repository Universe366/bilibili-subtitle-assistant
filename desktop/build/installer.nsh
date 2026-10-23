; 自定义卸载页：让用户选择是否同时删除本地数据。
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"

; 安装目录：浏览/输入一个已存在的父目录后，立刻把输入框补成
; 「父目录\拾字」，不用等到安装阶段。
; 目录页默认是「输入变化时校验」，所以 .onVerifyInstDir 能拿到刚选中的目录。
; 输入 $R0，输出 $R0：去掉末尾反斜杠，并补上程序文件夹（如果还没有）。
Function bsubNormalizeDir
  ${If} $R0 == ""
    Return
  ${EndIf}
  StrCpy $R1 "$R0" 1 -1
  ${If} $R1 == "\"
    StrCpy $R0 "$R0" -1
  ${EndIf}
  StrLen $R1 "${APP_FILENAME}"
  StrCpy $R2 "$R0" "" -$R1
  ${If} $R2 != "${APP_FILENAME}"
    StrCpy $R0 "$R0\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  ; 只处理已经存在的目录：用户正在逐字输入不存在的新路径时不要乱建目录。
  IfFileExists "$INSTDIR\*.*" 0 bsubVerifyDone

  StrCpy $R0 "$INSTDIR"
  Call bsubNormalizeDir
  StrCmp $R0 "$INSTDIR" bsubVerifyDone

  StrCpy $INSTDIR "$R0"
  CreateDirectory "$INSTDIR"

  ; 让目录页输入框立刻显示追加后的完整路径。
  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 != 0
    GetDlgItem $0 $0 1019
    ${If} $0 != 0
      SendMessage $0 0x000C 0 "STR:$INSTDIR"
    ${EndIf}
  ${EndIf}

bsubVerifyDone:
FunctionEnd

!macro customUnWelcomePage
  Var DeleteAppData
  Function un.bsubDeleteDataPageShow
    !insertmacro MUI_HEADER_TEXT "卸载 拾字" "选择是否保留本地数据"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 14u "同时删除本地数据（设置、字幕库、登录状态、缓存、日志、临时转写文件）"
    Pop $1
    ${NSD_Uncheck} $1

    ${NSD_CreateLabel} 0 22u 100% 48u "不勾选：只删除程序文件和快捷方式，保留数据目录 $APPDATA\bsub-desktop。$\r$\n勾选：删除当前数据目录（含自定义位置）、更新缓存和临时转写文件，无法恢复。"
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
    ; 设置、字幕库、总结、登录 Cookie、Electron 缓存、日志都在 userData 里。
    RMDir /r "$APPDATA\shizi"
    RMDir /r "$APPDATA\bsub-desktop"
    RMDir /r "$LOCALAPPDATA\shizi"
    RMDir /r "$LOCALAPPDATA\bsub-desktop"
    ; 用户可能在设置里把数据迁到了其它位置：读取指向文件一并删除。
    IfFileExists "$APPDATA\shizi-location.txt" 0 bsubLegacyPointer
      FileOpen $0 "$APPDATA\shizi-location.txt" r
      Goto bsubReadPointer
    bsubLegacyPointer:
    IfFileExists "$APPDATA\bsub-desktop-location.txt" 0 bsubNoCustomData
      FileOpen $0 "$APPDATA\bsub-desktop-location.txt" r
    bsubReadPointer:
      FileRead $0 $1
      FileClose $0
      ${TrimNewLines} "$1" $1
      StrLen $2 $1
      ${If} $2 > 3
        RMDir /r "$1"
      ${EndIf}
    bsubNoCustomData:
    Delete "$APPDATA\shizi-location.txt"
    Delete "$APPDATA\bsub-desktop-location.txt"
    ; 迁移后尚未删除的旧目录列表。
    IfFileExists "$APPDATA\shizi-cleanup.txt" 0 bsubLegacyCleanup
      FileOpen $0 "$APPDATA\shizi-cleanup.txt" r
      Goto bsubReadCleanup
    bsubLegacyCleanup:
    IfFileExists "$APPDATA\bsub-desktop-cleanup.txt" 0 bsubNoCleanup
      FileOpen $0 "$APPDATA\bsub-desktop-cleanup.txt" r
    bsubReadCleanup:
      bsubCleanupLoop:
        FileRead $0 $1
        StrCmp $1 "" bsubCleanupDone
        ${TrimNewLines} "$1" $1
        StrLen $2 $1
        ${If} $2 > 3
          RMDir /r "$1"
        ${EndIf}
        Goto bsubCleanupLoop
      bsubCleanupDone:
      FileClose $0
      Delete "$APPDATA\shizi-cleanup.txt"
      Delete "$APPDATA\bsub-desktop-cleanup.txt"
    bsubNoCleanup:
    ; 自动更新下载的安装包缓存。
    RMDir /r "$LOCALAPPDATA\shizi-updater"
    RMDir /r "$LOCALAPPDATA\bsub-desktop-updater"

    ; 转写过程中产生的 bsub-asr-* 临时目录（异常退出时可能残留）。
    FindFirst $0 $1 "$TEMP\bsub-asr-*"
    ${Do}
      StrCmp $1 "" done
      RMDir /r "$TEMP\$1"
      FindNext $0 $1
    ${Loop}
    done:
    FindClose $0
  ${EndIf}
!macroend
