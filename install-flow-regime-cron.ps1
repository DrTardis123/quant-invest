# ============================================
# 외국인 flow regime 자동 갱신 cron 등록
# ============================================
# 장 마감 후 평일 16:30 KST에 update_flow_regime.py 실행
# (supply-signals.json의 foreign_5d 합산 → regime 계산)
#
# 등록:
#   powershell -ExecutionPolicy Bypass -File .\install-flow-regime-cron.ps1
#
# 제거:
#   .\install-flow-regime-cron.ps1 -Uninstall
#   또는 schtasks /delete /tn "UpdateFlowRegime" /f
# ============================================

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$TaskName = "UpdateFlowRegime"
$ScriptPath = "C:\Users\LG\Documents\quant_invest\scripts\update_flow_regime.py"
$PythonExe = "C:\Users\LG\.minimax\workspace\minutes-kr\backend\.venv\Scripts\python.exe"
$LogDir = "C:\Users\LG\Documents\quant_invest\logs"

if ($Uninstall) {
    Write-Host "[uninstall] 작업 '$TaskName' 제거 중..."
    $existing = schtasks /query /tn $TaskName 2>&1
    if ($LASTEXITCODE -eq 0) {
        schtasks /delete /tn $TaskName /f | Out-Null
        Write-Host "[uninstall] 완료."
    } else {
        Write-Host "[uninstall] 등록된 작업 없음. 종료."
    }
    exit 0
}

# 사전 검증
Write-Host "[install] 사전 검증..."
foreach ($p in @($ScriptPath, $PythonExe)) {
    if (-not (Test-Path $p)) {
        Write-Error "필수 파일 없음: $p"
        exit 1
    }
}
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Write-Host "[install] 로그 디렉토리 생성: $LogDir"
}

# 기존 작업 제거 후 재등록 (idempotent)
$existing = schtasks /query /tn $TaskName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[install] 기존 작업 제거 후 재등록..."
    schtasks /delete /tn $TaskName /f | Out-Null
}

# 작업 등록: 평일 16:30 (월~금)
$Time = "16:30"
$Days = "MON,TUE,WED,THU,FRI"

# python을 직접 호출 (stdout/stderr를 로그로)
$TaskRun = "`"$PythonExe`" `"$ScriptPath`" >> `"$LogDir\flow-regime.log`" 2>&1"

Write-Host "[install] 작업 등록 중..."
Write-Host "  이름:     $TaskName"
Write-Host "  실행:     $TaskRun"
Write-Host "  시간:     매일 $Time (평일만)"
Write-Host "  로그:     $LogDir\flow-regime.log"

# /sc weekly + /d MON,TUE,WED,THU,FRI 조합이 가장 호환성 높음
schtasks /create `
    /tn $TaskName `
    /tr $TaskRun `
    /sc weekly `
    /d $Days `
    /st $Time `
    /rl HIGHEST `
    /f | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Error "schtasks 등록 실패 (exit $LASTEXITCODE)"
    exit 1
}

Write-Host ""
Write-Host "[install] ✅ 등록 완료."
Write-Host ""
Write-Host "확인:"
Write-Host "  schtasks /query /tn $TaskName /v /fo LIST"
Write-Host ""
Write-Host "수동 실행 (테스트):"
Write-Host "  schtasks /run /tn $TaskName"
Write-Host ""
Write-Host "제거:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\install-flow-regime-cron.ps1 -Uninstall"
