param(
  [switch]$OpenExtensionPage
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$serverEntry = Join-Path $Root "apps/server/dist/index.js"
$extensionManifest = Join-Path $Root "apps/extension/dist/manifest.json"
$extensionDir = Join-Path $Root "apps/extension/dist"

Write-Host ""
Write-Host "직구의제왕을 실행합니다." -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $serverEntry) -or -not (Test-Path $extensionManifest)) {
  Write-Host "빌드 결과가 없어 먼저 빌드합니다..." -ForegroundColor Cyan
  npm run build
}

Write-Host "Chrome 확장 프로그램 폴더:" -ForegroundColor Yellow
Write-Host $extensionDir
Write-Host ""
Write-Host "Chrome에서 chrome://extensions 를 열고, 개발자 모드 > 압축해제된 확장 프로그램 로드로 위 폴더를 선택하세요."
Write-Host "이미 로드했다면 확장 프로그램 새로고침 버튼만 누르면 됩니다."
Write-Host ""

if ($OpenExtensionPage) {
  try {
    Start-Process "chrome.exe" "chrome://extensions"
  } catch {
    Write-Host "Chrome 확장 프로그램 페이지를 자동으로 열지 못했습니다. 직접 chrome://extensions 를 열어주세요." -ForegroundColor Yellow
  }

  if (Test-Path $extensionDir) {
    Invoke-Item $extensionDir
  }
}

Write-Host "Agent 서버를 시작합니다: http://localhost:8787" -ForegroundColor Green
Write-Host "서버를 종료하려면 이 창에서 Ctrl+C를 누르세요."
Write-Host ""
npm run start:server
