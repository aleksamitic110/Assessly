param(
  [switch]$WithJudge0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverEnvPath = Join-Path $rootDir 'server/.env'
$composeFilePath = Join-Path $rootDir 'docker-compose.yml'

Write-Host '==> Checking required files...'

if (-not (Test-Path $serverEnvPath)) {
  throw "Missing file: $serverEnvPath"
}

if (-not (Test-Path $composeFilePath)) {
  throw "Missing file: $composeFilePath"
}

# Read CASSANDRA_BUNDLE_PATH from server/.env
$envLines = Get-Content $serverEnvPath
$bundleLine = $envLines | Where-Object { $_ -match '^\s*CASSANDRA_BUNDLE_PATH\s*=' } | Select-Object -First 1

if (-not $bundleLine) {
  throw 'Missing CASSANDRA_BUNDLE_PATH in server/.env'
}

$bundlePathRaw = (($bundleLine -split '=', 2)[1]).Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($bundlePathRaw)) {
  throw 'CASSANDRA_BUNDLE_PATH is empty in server/.env'
}

$bundlePath = if ([System.IO.Path]::IsPathRooted($bundlePathRaw)) {
  $bundlePathRaw
} else {
  Join-Path (Join-Path $rootDir 'server') $bundlePathRaw
}

if (-not (Test-Path $bundlePath)) {
  throw "Missing Cassandra secure bundle zip: $bundlePath"
}

Write-Host "OK: Found Cassandra bundle -> $bundlePath"

# Read Judge0 image tag from docker-compose.yml (fallback to 1.13.1)
$composeText = Get-Content $composeFilePath -Raw
$judgeTag = '1.13.1'
$judgeImageMatch = [regex]::Match($composeText, 'image:\s*judge0/judge0:([^\s]+)')
if ($judgeImageMatch.Success) {
  $judgeTag = $judgeImageMatch.Groups[1].Value.Trim()
}
$judgeImage = "judge0/judge0:$judgeTag"

if ($WithJudge0) {
  # Find Judge0 config folder (judge0/judge0-v{tag}) if present
  $judgeVersionDir = Join-Path (Join-Path $rootDir 'judge0') ("judge0-v$judgeTag")
  if (-not (Test-Path $judgeVersionDir)) {
    $fallbackDir = Get-ChildItem (Join-Path $rootDir 'judge0') -Directory -Filter 'judge0-v*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($fallbackDir) {
      $judgeVersionDir = $fallbackDir.FullName
    }
  }

  if (-not (Test-Path $judgeVersionDir)) {
    throw "Could not find Judge0 version folder under: $(Join-Path $rootDir 'judge0')"
  }

  Write-Host "==> Entering Judge0 folder: $judgeVersionDir"
  Push-Location $judgeVersionDir
  try {
    Write-Host "==> Pulling $judgeImage ..."
    & docker pull $judgeImage
    if ($LASTEXITCODE -ne 0) {
      throw "docker pull failed for $judgeImage"
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host '==> Judge0 mode disabled (C++ local runner only).'
}

# Prefer `docker compose`, fallback to `docker-compose`
$useComposeV2 = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  & docker compose version *> $null
  if ($LASTEXITCODE -eq 0) {
    $useComposeV2 = $true
  }
}

Write-Host "==> Starting containers from project root..."
Push-Location $rootDir
try {
  $composeArgs = @()
  $services = @()
  $overridePath = $null

  if ($WithJudge0) {
    $services = @()
  } else {
    # Override Judge0 env vars inside server container and run only required services.
    $overridePath = Join-Path $env:TEMP ("assessly-no-judge0.{0}.yml" -f ([guid]::NewGuid().ToString('N')))
    $overrideYaml = @'
services:
  server:
    environment:
      JUDGE0_BASE_URL: ""
      JUDGE0_AUTH_HEADER: ""
      JUDGE0_AUTH_TOKEN: ""
      JUDGE0_AUTHZ_HEADER: ""
      JUDGE0_AUTHZ_TOKEN: ""
'@
    Set-Content -Path $overridePath -Value $overrideYaml -Encoding utf8
    $composeArgs = @('-f', $composeFilePath, '-f', $overridePath)
    $services = @('server', 'client')
  }

  if ($useComposeV2) {
    & docker compose @composeArgs up --build -d @services
  } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    & docker-compose @composeArgs up --build -d @services
  } else {
    throw 'Neither `docker compose` nor `docker-compose` is available.'
  }

  if ($LASTEXITCODE -ne 0) {
    throw 'Compose up failed.'
  }
} finally {
  if ($overridePath -and (Test-Path $overridePath)) {
    Remove-Item $overridePath -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}

if ($WithJudge0) {
  Write-Host 'Done. Started with Judge0.'
} else {
  Write-Host 'Done. Started without Judge0 (C++ local runner mode).'
  Write-Host 'Tip: To start with Judge0, run: .\up-first-run.ps1 -WithJudge0'
}
