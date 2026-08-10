# setup.ps1 - GitHub push helper (English-only version for compatibility)
# Run: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = 'Stop'

Write-Host "=== Quant Invest Dashboard - GitHub Push Helper ===" -ForegroundColor Cyan
Write-Host ""

# Check git user
$user = git config user.name
$email = git config user.email
if (-not $user -or -not $email) {
    Write-Host "Git user is not configured." -ForegroundColor Yellow
    $user = Read-Host "Enter your GitHub username"
    $email = Read-Host "Enter your GitHub email"
    git config --global user.name "$user"
    git config --global user.email "$email"
    Write-Host "Git user configured." -ForegroundColor Green
}

Write-Host ""
Write-Host "Enter your GitHub repo URL (e.g. https://github.com/Drtardis/quant-invest.git)"
Write-Host "First create an empty repo at https://github.com/new" -ForegroundColor Yellow
$repoUrl = Read-Host "Repo URL"

if (-not $repoUrl) {
    Write-Host "Repo URL is required." -ForegroundColor Red
    exit 1
}

# Current folder
$base = Get-Location
Write-Host ""
Write-Host "Working folder: $base" -ForegroundColor Cyan

# Git init (skip if already)
if (-not (Test-Path .git)) {
    Write-Host "git init..."
    git init
    git branch -M main
} else {
    Write-Host ".git already exists" -ForegroundColor Gray
}

Write-Host "git add ..."
git add .

$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit." -ForegroundColor Yellow
} else {
    Write-Host "git commit ..."
    git commit -m "initial commit: quant invest dashboard"
}

# Remote setup
$remote = git remote get-url origin 2>$null
if (-not $remote) {
    Write-Host "remote add origin $repoUrl"
    git remote add origin $repoUrl
} elseif ($remote -ne $repoUrl) {
    Write-Host "Current origin: $remote" -ForegroundColor Yellow
    $ans = Read-Host "Change it? (y/N)"
    if ($ans -eq 'y') {
        git remote set-url origin $repoUrl
    }
}

# Push
Write-Host ""
Write-Host "git push -u origin main"
Write-Host "(GitHub auth required - Personal Access Token recommended)" -ForegroundColor Yellow
try {
    git push -u origin main
    Write-Host ""
    Write-Host "Push complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Go to https://vercel.com -> sign in with GitHub"
    Write-Host "2. 'Add New Project' -> select the quant-invest repo"
    Write-Host "3. Click Deploy (1-2 min)"
    Write-Host "4. Go to GitHub Actions tab -> 'Daily Data Update' -> 'Run workflow'"
    Write-Host "5. Wait 30-60 min for first data population"
} catch {
    Write-Host "Push failed: $_" -ForegroundColor Red
    Write-Host "Use a Personal Access Token if not already." -ForegroundColor Yellow
}
