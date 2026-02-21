param(
  [switch]$WithJudge0,
  [ValidateRange(10, 1800)]
  [int]$WakeTimeoutSeconds = 180,
  [ValidateRange(1, 60)]
  [int]$WakePollSeconds = 3
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverEnvPath = Join-Path $rootDir 'server/.env'
$composeFilePath = Join-Path $rootDir 'docker-compose.yml'

function Get-ErrorMessage {
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )

  if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
    return $ErrorRecord.ErrorDetails.Message.Trim()
  }

  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Message) {
    return $ErrorRecord.Exception.Message.Trim()
  }

  return 'Unknown error.'
}

function Test-JsonStatusEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSec = 8
  )

  try {
    $response = Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec $TimeoutSec
    if ($null -eq $response) {
      return [pscustomobject]@{
        Ok = $false
        Message = 'Empty response.'
      }
    }

    $statusValue = ''
    if ($response.PSObject.Properties.Name -contains 'status') {
      $statusValue = [string]$response.status
    }

    if ($statusValue -eq 'ok') {
      $messageValue = ''
      if ($response.PSObject.Properties.Name -contains 'message' -and $null -ne $response.message) {
        $messageValue = [string]$response.message
      }

      return [pscustomobject]@{
        Ok = $true
        Message = $messageValue.Trim()
      }
    }

    return [pscustomobject]@{
      Ok = $false
      Message = "Unexpected status: '$statusValue'"
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Message = (Get-ErrorMessage -ErrorRecord $_)
    }
  }
}

function Wait-ForDependenciesWake {
  param(
    [int]$TimeoutSeconds,
    [int]$PollSeconds
  )

  if ($PollSeconds -gt $TimeoutSeconds) {
    throw 'WakePollSeconds cannot be greater than WakeTimeoutSeconds.'
  }

  $checks = @(
    @{ Name = 'Cassandra'; Url = 'http://localhost:3000/status/cassandra'; IsAwake = $false; LastMessage = 'No response yet.' },
    @{ Name = 'Redis'; Url = 'http://localhost:3000/status/redis'; IsAwake = $false; LastMessage = 'No response yet.' },
    @{ Name = 'Neo4j'; Url = 'http://localhost:3000/status/neo4j'; IsAwake = $false; LastMessage = 'No response yet.' }
  )

  Write-Host "==> Waking Cassandra, Redis and Neo4j (timeout: ${TimeoutSeconds}s)..."
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $pendingCount = 0

    foreach ($check in $checks) {
      if ($check.IsAwake) {
        continue
      }

      $result = Test-JsonStatusEndpoint -Url $check.Url -TimeoutSec ([Math]::Min(10, $PollSeconds + 2))
      if ($result.Ok) {
        $check.IsAwake = $true
        if ([string]::IsNullOrWhiteSpace($result.Message)) {
          Write-Host "$($check.Name) Waked."
        } else {
          Write-Host "$($check.Name) Waked. ($($result.Message))"
        }
      } else {
        $check.LastMessage = $result.Message
        $pendingCount++
      }
    }

    if ($pendingCount -eq 0) {
      return $true
    }

    Start-Sleep -Seconds $PollSeconds
  }

  foreach ($check in $checks) {
    if (-not $check.IsAwake) {
      Write-Warning "$($check.Name) did not wake in time (${TimeoutSeconds}s). Last response: $($check.LastMessage)"
    }
  }

  return $false
}

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

$dependenciesAwake = Wait-ForDependenciesWake -TimeoutSeconds $WakeTimeoutSeconds -PollSeconds $WakePollSeconds

if ($WithJudge0) {
  Write-Host 'Done. Started with Judge0.'
} else {
  Write-Host 'Done. Started without Judge0 (C++ local runner mode).'
  Write-Host 'Tip: To start with Judge0, run: .\up-first-run.ps1 -WithJudge0'
}

if ($dependenciesAwake) {
  Write-Host 'All dependencies are awake and ready.'
} else {
  Write-Warning 'Some dependencies are still sleeping. Login can fail until they wake up.'
  Write-Host 'Tip: Check backend logs with: docker logs --tail 120 assessly-server'
}
