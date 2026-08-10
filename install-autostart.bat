@echo off
REM ============================================
REM Windows 시작프로그램에 등록 (부팅 시 자동 실행)
REM 관리자 권한 필요할 수 있음
REM ============================================
setlocal
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\quant_invest.bat"
set "TARGET=%~dp0start.bat"

echo [autostart] 시작프로그램에 등록합니다...
echo [autostart] 위치: %SHORTCUT%
echo [autostart] 대상: %TARGET%

REM 단순 복사 (가장 호환성 높음)
copy /Y "%TARGET%" "%SHORTCUT%" >nul
if errorlevel 1 (
  echo [autostart] 실패. 직접 %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ 폴더에
  echo            start.bat 의 바로가기를 만들어 주세요.
  exit /b 1
)

echo [autostart] 완료. 이제 PC를 재시작하면 자동으로 서버가 올라옵니다.
echo [autostart] 수동 시작: start.bat 더블클릭
echo [autostart] 수동 정지: 작업 관리자에서 node.exe 종료
endlocal
