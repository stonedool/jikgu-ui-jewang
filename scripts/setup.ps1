param(
  [switch]$SkipRag,
  [switch]$NoBuild,
  [string]$OpenAIKey = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Require-Command {
  param(
    [string]$Name,
    [string]$Hint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name 명령을 찾지 못했습니다. $Hint"
  }
}

function Set-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $content = ""
  if (Test-Path $Path) {
    $content = Get-Content -Path $Path -Raw
  }

  $escapedKey = [regex]::Escape($Key)
  if ($content -match "(?m)^$escapedKey=") {
    $content = [regex]::Replace($content, "(?m)^$escapedKey=.*$", "$Key=$Value")
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "$Key=$Value`r`n"
  }

  Set-Content -Path $Path -Value $content -Encoding utf8
}

Write-Host ""
Write-Host "직구의제왕 첫 설치를 시작합니다." -ForegroundColor Cyan
Write-Host ""

Require-Command "node" "Node.js 20 이상을 설치한 뒤 다시 실행하세요: https://nodejs.org/"
Require-Command "npm" "Node.js를 설치하면 함께 제공됩니다."
Require-Command "python" "Python 3.10 이상을 설치하고 PATH에 추가한 뒤 다시 실행하세요: https://www.python.org/downloads/"

$nodeVersion = (node -v).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "현재 Node.js 버전은 $nodeVersion 입니다. Node.js 20 이상이 필요합니다."
}

$envPath = Join-Path $Root "apps/server/.env"
$envExamplePath = Join-Path $Root "apps/server/.env.example"
if (-not (Test-Path $envPath)) {
  Copy-Item -Path $envExamplePath -Destination $envPath
  Write-Host "apps/server/.env 파일을 생성했습니다."
}

if ($OpenAIKey.Trim().Length -gt 0) {
  Set-EnvValue -Path $envPath -Key "OPENAI_API_KEY" -Value $OpenAIKey.Trim()
  Write-Host "OpenAI API 키를 .env에 반영했습니다."
}

Write-Host ""
Write-Host "Node 패키지를 설치합니다..." -ForegroundColor Cyan
npm install

if (-not $SkipRag) {
  Write-Host ""
  Write-Host "FAISS RAG 실행에 필요한 Python 패키지를 설치합니다..." -ForegroundColor Cyan
  npm run setup:rag -w apps/server

  Write-Host ""
  Write-Host "직구 문서를 내려받고 FAISS 인덱스를 생성합니다..." -ForegroundColor Cyan
  npm run build:rag -w apps/server
}

if (-not $NoBuild) {
  Write-Host ""
  Write-Host "서버와 Chrome 확장 프로그램을 빌드합니다..." -ForegroundColor Cyan
  npm run build
}

Write-Host ""
Write-Host "설치가 끝났습니다." -ForegroundColor Green
Write-Host "실행은 start-windows.bat 또는 npm run start:windows 로 시작하세요."
Write-Host "OpenAI 키를 나중에 바꾸려면 apps/server/.env 파일을 수정하면 됩니다."
