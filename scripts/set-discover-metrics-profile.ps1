Param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("safe", "balanced", "aggressive")]
  [string]$Profile = "balanced",

  [Parameter(Mandatory = $false)]
  [string]$ProjectRef = "",

  [Parameter(Mandatory = $false)]
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Load-DotEnv {
  Param([string]$Path = ".env")
  if (!(Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+)=(.*)\s*$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim().Trim('"').Trim("'")
      if (-not [string]::IsNullOrWhiteSpace($k) -and -not [Environment]::GetEnvironmentVariable($k, "Process")) {
        [Environment]::SetEnvironmentVariable($k, $v, "Process")
      }
    }
  }
}

function Resolve-ProjectRef {
  Param([string]$ExplicitRef)
  if (-not [string]::IsNullOrWhiteSpace($ExplicitRef)) { return $ExplicitRef }

  $ref = [Environment]::GetEnvironmentVariable("SUPABASE_PROJECT_REF", "Process")
  if (-not [string]::IsNullOrWhiteSpace($ref)) { return $ref }

  $url = [Environment]::GetEnvironmentVariable("SUPABASE_URL", "Process")
  if ([string]::IsNullOrWhiteSpace($url)) {
    $url = [Environment]::GetEnvironmentVariable("VITE_SUPABASE_URL", "Process")
  }
  if (-not [string]::IsNullOrWhiteSpace($url)) {
    try {
      $host = ([Uri]$url).Host
      if ($host -match '^([a-z0-9-]+)\.supabase\.co$') {
        return $matches[1]
      }
    } catch { }
  }

  $configToml = Join-Path (Get-Location).Path "supabase\config.toml"
  if (Test-Path $configToml) {
    $cfg = Get-Content -Raw $configToml
    if ($cfg -match 'project_id\s*=\s*"([a-z0-9-]+)"') {
      return $matches[1]
    }
  }

  throw "Could not resolve project ref. Pass -ProjectRef <ref> or set SUPABASE_URL/VITE_SUPABASE_URL."
}

function Get-ProfileConfig {
  Param([string]$Name)
  switch ($Name) {
    "safe" {
      return @{
        DISCOVER_METRICS_V2_WORKERS = 4
        DISCOVER_METRICS_V2_CLAIM_SIZE_PER_WORKER = 500
        DISCOVER_METRICS_V2_WORKER_INITIAL_CONCURRENCY = 3
        DISCOVER_METRICS_V2_WORKER_MIN_CONCURRENCY = 1
        DISCOVER_METRICS_V2_WORKER_MAX_CONCURRENCY = 8
        DISCOVER_METRICS_V2_STALE_AFTER_SECONDS = 900
        DISCOVER_METRICS_V2_WORKER_BUDGET_MS = 55000
        DISCOVER_METRICS_V2_CHUNK_SIZE = 500
        DISCOVER_METRICS_V2_GLOBAL_DELAY_MS = 250
      }
    }
    "balanced" {
      return @{
        DISCOVER_METRICS_V2_WORKERS = 6
        DISCOVER_METRICS_V2_CLAIM_SIZE_PER_WORKER = 700
        DISCOVER_METRICS_V2_WORKER_INITIAL_CONCURRENCY = 5
        DISCOVER_METRICS_V2_WORKER_MIN_CONCURRENCY = 1
        DISCOVER_METRICS_V2_WORKER_MAX_CONCURRENCY = 12
        DISCOVER_METRICS_V2_STALE_AFTER_SECONDS = 600
        DISCOVER_METRICS_V2_WORKER_BUDGET_MS = 58000
        DISCOVER_METRICS_V2_CHUNK_SIZE = 500
        DISCOVER_METRICS_V2_GLOBAL_DELAY_MS = 120
      }
    }
    "aggressive" {
      return @{
        DISCOVER_METRICS_V2_WORKERS = 8
        DISCOVER_METRICS_V2_CLAIM_SIZE_PER_WORKER = 900
        DISCOVER_METRICS_V2_WORKER_INITIAL_CONCURRENCY = 6
        DISCOVER_METRICS_V2_WORKER_MIN_CONCURRENCY = 1
        DISCOVER_METRICS_V2_WORKER_MAX_CONCURRENCY = 16
        DISCOVER_METRICS_V2_STALE_AFTER_SECONDS = 450
        DISCOVER_METRICS_V2_WORKER_BUDGET_MS = 59000
        DISCOVER_METRICS_V2_CHUNK_SIZE = 500
        DISCOVER_METRICS_V2_GLOBAL_DELAY_MS = 60
      }
    }
    default {
      throw "Unknown profile: $Name"
    }
  }
}

Load-DotEnv
$resolvedRef = Resolve-ProjectRef -ExplicitRef $ProjectRef
$cfg = Get-ProfileConfig -Name $Profile

$pairs = @()
foreach ($k in $cfg.Keys) {
  $pairs += "$k=$($cfg[$k])"
}

Write-Host "Applying discover metrics profile..."
Write-Host "- profile: $Profile"
Write-Host "- project_ref: $resolvedRef"
Write-Host "- values:"
foreach ($k in ($cfg.Keys | Sort-Object)) {
  Write-Host ("  - {0}={1}" -f $k, $cfg[$k])
}

$cmd = @("supabase@latest", "secrets", "set")
$cmd += $pairs
$cmd += @("--project-ref", $resolvedRef)

if ($DryRun) {
  Write-Host ""
  Write-Host "Dry run enabled. Command preview:"
  Write-Host ("npx " + ($cmd -join " "))
  exit 0
}

& npx @cmd
if ($LASTEXITCODE -ne 0) {
  throw "Failed to set secrets for profile '$Profile'"
}

Write-Host ""
Write-Host "Done."
Write-Host "Next step:"
Write-Host "  npx supabase@latest functions deploy discover-collector --project-ref $resolvedRef"
