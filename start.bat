@echo off
REM ============================================
REM 퀀트 투자 대시보드 시작 스크립트
REM 더블클릭 또는 시작프로그램에 등록
REM ============================================
cd /d "%~dp0"
echo [start.bat] %date% %time% - 서버 시작
node src\index.js >> logs\server.log 2>&1
