param(
  [string]$AuthorizationCode,
  [string]$Branch = "++Fortnite+Release-39.30",
  [string]$SurfaceName = "CreativeDiscoverySurface_Frontend",
  [int]$Iterations = 9,
  [string]$SearchTerm = "box",
  [string]$CreatorTerm = "epic",
  [ValidateSet("bearer", "eg1")][string]$TokenType = "bearer"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# fortnitePCGameClient (publicly documented)
$ClientId = "ec684b8c687f479fadea3cb2ad83f5c6"
$ClientSecret = "e1f31c211f28413186262d37a13fc84d"

function To-Base64([string]$s) {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))
}

function Percentile([double[]]$vals, [double]$p) {
  if (-not $vals -or $vals.Count -eq 0) { return $null }
  $sorted = $vals | Sort-Object
  $n = $sorted.Count
  if ($n -eq 1) { return [Math]::Round([double]$sorted[0], 1) }
  $idx = [Math]::Floor($p * ($n - 1))
  return [Math]::Round([double]$sorted[$idx], 1)
}

function Invoke-TimedJson {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][ValidateSet("GET","POST")][string]$Method,
    [Parameter(Mandatory=$true)][string]$Url,
    [hashtable]$Headers = @{},
    [string]$ContentType,
    [string]$Body
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $status = -1
  $raw = $null
  $json = $null
  $err = $null

  try {
    $args = @{
      Uri = $Url
      Method = $Method
      Headers = $Headers
      UseBasicParsing = $true
    }
    if ($ContentType) { $args.ContentType = $ContentType }
    if ($Body) { $args.Body = $Body }

    $resp = Invoke-WebRequest @args
    $status = [int]$resp.StatusCode
    $raw = $resp.Content
  } catch {
    $ex = $_.Exception
    if ($ex.Response) {
      try {
        $status = [int]$ex.Response.StatusCode.value__
      } catch {
        $status = -1
      }
      try {
        $stream = $ex.Response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $raw = $reader.ReadToEnd()
        }
      } catch {
        $raw = $null
      }
    } else {
      $status = -1
      $raw = $ex.Message
    }
    $err = $_.Exception.Message
  } finally {
    $sw.Stop()
  }

  if ($raw) {
    try { $json = $raw | ConvertFrom-Json -ErrorAction Stop } catch { $json = $null }
  }

  return [pscustomobject]@{
    name = $Name
    method = $Method
    url = $Url
    status = $status
    ms = [Math]::Round($sw.Elapsed.TotalMilliseconds, 1)
    ok = ($status -ge 200 -and $status -le 299)
    json = $json
    rawPreview = if ($raw) { ($raw.Substring(0, [Math]::Min(220, $raw.Length))) } else { $null }
    error = $err
  }
}

function Measure-Endpoint {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][scriptblock]$Call,
    [int]$N = 9
  )
  $times = New-Object System.Collections.Generic.List[double]
  $ok = 0
  $last = $null

  for ($i=0; $i -lt $N; $i++) {
    $r = & $Call
    $last = $r
    $times.Add([double]$r.ms) | Out-Null
    if ($r.ok) { $ok++ }
    Start-Sleep -Milliseconds 80
  }

  return [pscustomobject]@{
    name = $Name
    n = $N
    success = $ok
    success_rate = [Math]::Round(($ok / [Math]::Max(1, $N)) * 100, 1)
    p50_ms = (Percentile $times.ToArray() 0.50)
    p95_ms = (Percentile $times.ToArray() 0.95)
    last_status = $last.status
    last_preview = $last.rawPreview
  }
}

Write-Host "Epic Discovery Smoke Test"
Write-Host ("- Branch: {0}" -f $Branch)
Write-Host ("- Surface: {0}" -f $SurfaceName)
Write-Host ("- Iterations per endpoint: {0}" -f $Iterations)
Write-Host ""

if (-not $AuthorizationCode) {
  $AuthorizationCode = Read-Host "Cole o authorizationCode (responseType=code)"
}
if (-not $AuthorizationCode) { throw "authorizationCode vazio" }

$basic = To-Base64 ("{0}:{1}" -f $ClientId, $ClientSecret)

# 1) Exchange authorization code -> EG1 access token
$tokenUrl = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token"
$tokenBody = "grant_type=authorization_code&code=$([Uri]::EscapeDataString($AuthorizationCode))"
if ($TokenType -eq "eg1") { $tokenBody = "$tokenBody&token_type=eg1" }
$tokenResp = Invoke-TimedJson -Name "oauth_token_exchange" -Method "POST" -Url $tokenUrl -Headers @{ Authorization = "Basic $basic" } -ContentType "application/x-www-form-urlencoded" -Body $tokenBody

if (-not $tokenResp.ok) {
  Write-Host ("exchange failed (HTTP {0})" -f $tokenResp.status)
  Write-Host $tokenResp.rawPreview
  throw "Nao foi possivel trocar authorizationCode por access_token"
}

$accessToken = [string]$tokenResp.json.access_token
$accountId = [string]$tokenResp.json.account_id
$refreshToken = [string]$tokenResp.json.refresh_token
if (-not $accessToken -or -not $accountId) { throw "Resposta de token sem access_token/account_id" }

$accessTokenRedacted = "{0}...{1}" -f $accessToken.Substring(0,8), $accessToken.Substring([Math]::Max(0, $accessToken.Length-6))
Write-Host ("- account_id: {0}" -f $accountId)
Write-Host ("- access_token: {0} (redacted)" -f $accessTokenRedacted)

# 2) Verify perms
$verifyUrl = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/verify?includePerms=true"
$verifyResp = Invoke-TimedJson -Name "oauth_verify" -Method "GET" -Url $verifyUrl -Headers @{ Authorization = "Bearer $accessToken" }
if (-not $verifyResp.ok) {
  Write-Host ("verify failed (HTTP {0})" -f $verifyResp.status)
  Write-Host $verifyResp.rawPreview
  throw "Nao foi possivel verificar permissoes do token"
}

$perms = @()
if ($verifyResp.json.perms -is [System.Collections.IEnumerable]) { $perms = @($verifyResp.json.perms) }

# perms can be string[] or object[] with { resource, action }
$permResources = @()
foreach ($p in $perms) {
  if ($p -is [string]) { $permResources += $p; continue }
  try {
    if ($null -ne $p.resource) { $permResources += [string]$p.resource; continue }
  } catch {}
}
$permHits = @($permResources | Where-Object { $_ -match "fortnite:discovery:fortnite" -or $_ -match "^discovery:surface:query$" -or $_ -match "^discovery:search:" -or $_ -match ":creator:page$" })
Write-Host ("- perms_total: {0}" -f $perms.Count)
Write-Host ("- perms_discovery_hits: {0}" -f $permHits.Count)
if ($permHits.Count -gt 0) {
  $permHits | Select-Object -First 30 | ForEach-Object { Write-Host ("  perm: {0}" -f $_) }
}

# 3) accessToken/:branch (Discovery access token)
$branchEnc = [Uri]::EscapeDataString($Branch)
$discTokUrl = "https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/discovery/accessToken/$branchEnc"
$discTokCall = { Invoke-TimedJson -Name "discovery_access_token" -Method "GET" -Url $discTokUrl -Headers @{ Authorization = "Bearer $accessToken" } }
$discTokStats = Measure-Endpoint -Name "discovery_access_token" -Call $discTokCall -N $Iterations

if ($discTokStats.last_status -ne 200) {
  Write-Host ""
  Write-Host ("Discovery accessToken falhou (last HTTP {0}). Preview:" -f $discTokStats.last_status)
  Write-Host $discTokStats.last_preview
  Write-Host ""
  Write-Host "Observacao: mesmo com perm listando fortnite:discovery:fortnite, alguns servicos rejeitam token EG1."
  Write-Host "Sugestao: rode novamente com TokenType=bearer (default) ou TokenType=eg1."
  throw "Falha no discovery access token"
}

# Use one fresh call to fetch the token payload (do not rely on the last measured response).
$discTokResp = & $discTokCall
$discAccessToken = [string]$discTokResp.json.token
if (-not $discAccessToken) { throw "Discovery access token vazio" }

# 4) v2/surface
$streamEnc = [Uri]::EscapeDataString($Branch)
$surfaceUrl = "https://fn-service-discovery-live-public.ogs.live.on.epicgames.com/api/v2/discovery/surface/${SurfaceName}?appId=Fortnite&stream=$streamEnc"
$surfaceBodyObj = @{
  playerId = $accountId
  partyMemberIds = @($accountId)
  locale = "en"
  matchmakingRegion = "NAE"
  platform = "Windows"
  isCabined = $false
  ratingAuthority = "ESRB"
  rating = "TEEN"
  numLocalPlayers = 1
}
$surfaceBody = ($surfaceBodyObj | ConvertTo-Json -Depth 6 -Compress)
$surfaceCall = {
  Invoke-TimedJson -Name "v2_surface" -Method "POST" -Url $surfaceUrl -Headers @{
    Authorization = "Bearer $accessToken"
    "X-Epic-Access-Token" = $discAccessToken
  } -ContentType "application/json" -Body $surfaceBody
}
$surfaceStats = Measure-Endpoint -Name "v2_surface" -Call $surfaceCall -N $Iterations

$surfaceResp = & $surfaceCall
if (-not $surfaceResp.ok) { throw "v2/surface falhou (HTTP $($surfaceResp.status))" }

$testVariantName = [string]$surfaceResp.json.testVariantName
$panels = @($surfaceResp.json.panels)
$panelName = $null
$linkCodeFromSurface = $null
if ($panels.Count -gt 0) {
  $panelName = [string]$panels[0].panelName
  $firstResults = @($panels[0].firstPage.results)
  if ($firstResults.Count -gt 0) {
    $linkCodeFromSurface = [string]$firstResults[0].linkCode
  }
}
if (-not $panelName) { $panelName = "Featured_EpicPage" }
if (-not $linkCodeFromSurface) { $linkCodeFromSurface = "playlist_trios" }

# 5) v2/page
$pageUrl = "https://fn-service-discovery-live-public.ogs.live.on.epicgames.com/api/v2/discovery/surface/${SurfaceName}/page?appId=Fortnite&stream=$streamEnc"
$pageBodyObj = @{
  testVariantName = if ($testVariantName) { $testVariantName } else { "Baseline" }
  panelName = $panelName
  pageIndex = 0
  playerId = $accountId
  partyMemberIds = @($accountId)
  locale = "en"
  matchmakingRegion = "NAE"
  platform = "Windows"
  isCabined = $false
  ratingAuthority = "ESRB"
  rating = "TEEN"
  numLocalPlayers = 1
}
$pageBody = ($pageBodyObj | ConvertTo-Json -Depth 6 -Compress)
$pageCall = {
  Invoke-TimedJson -Name "v2_page" -Method "POST" -Url $pageUrl -Headers @{
    Authorization = "Bearer $accessToken"
    "X-Epic-Access-Token" = $discAccessToken
  } -ContentType "application/json" -Body $pageBody
}
$pageStats = Measure-Endpoint -Name "v2_page" -Call $pageCall -N $Iterations

# 6) link-entries
$linkEntriesUrl = "https://fn-service-discovery-live-public.ogs.live.on.epicgames.com/api/v2/discovery/link-entries"
$linkEntriesBody = (@{ linkCodes = @($linkCodeFromSurface) } | ConvertTo-Json -Depth 4 -Compress)
$linkEntriesCall = {
  Invoke-TimedJson -Name "link_entries" -Method "POST" -Url $linkEntriesUrl -Headers @{
    Authorization = "Bearer $accessToken"
    "X-Epic-Access-Token" = $discAccessToken
  } -ContentType "application/json" -Body $linkEntriesBody
}
$linkEntriesStats = Measure-Endpoint -Name "link_entries" -Call $linkEntriesCall -N $Iterations

# 7) search links
$searchLinksUrl = "https://fngw-svc-gc-livefn.ol.epicgames.com/api/island-search/v1/search?accountId=${accountId}"
$searchLinksBody = (@{
  namespace = "fortnite"
  context = @()
  locale = "en-US"
  search = $SearchTerm
  orderBy = "globalCCU"
  ratingAuthority = ""
  rating = ""
  page = 0
} | ConvertTo-Json -Depth 6 -Compress)
$searchLinksCall = {
  Invoke-TimedJson -Name "search_links" -Method "POST" -Url $searchLinksUrl -Headers @{ Authorization = "Bearer $accessToken" } -ContentType "application/json" -Body $searchLinksBody
}
$searchLinksStats = Measure-Endpoint -Name "search_links" -Call $searchLinksCall -N $Iterations

$searchLinksResp = & $searchLinksCall
$linkCodeFromSearch = $null
try {
  $results = @($searchLinksResp.json.results)
  if ($results.Count -gt 0) { $linkCodeFromSearch = [string]$results[0].linkCode }
} catch {}

# 8) search creators
$searchCreatorsUrl = "https://fngw-svc-gc-livefn.ol.epicgames.com/api/creator-search/v1/search?accountId=${accountId}"
$searchCreatorsBody = (@{ creatorTerm = $CreatorTerm } | ConvertTo-Json -Depth 4 -Compress)
$searchCreatorsCall = {
  Invoke-TimedJson -Name "search_creators" -Method "POST" -Url $searchCreatorsUrl -Headers @{ Authorization = "Bearer $accessToken" } -ContentType "application/json" -Body $searchCreatorsBody
}
$searchCreatorsStats = Measure-Endpoint -Name "search_creators" -Call $searchCreatorsCall -N $Iterations

$searchCreatorsResp = & $searchCreatorsCall
$creatorAccountId = $null
try {
  $cresults = @($searchCreatorsResp.json.results)
  if ($cresults.Count -gt 0) { $creatorAccountId = [string]$cresults[0].accountId }
} catch {}
if (-not $creatorAccountId) { $creatorAccountId = "epic" }

# 9) creator page
$creatorPageUrl = "https://fn-service-discovery-live-public.ogs.live.on.epicgames.com/api/v1/creator/page/${creatorAccountId}?playerId=${accountId}&limit=100"
$creatorPageCall = {
  Invoke-TimedJson -Name "creator_page" -Method "GET" -Url $creatorPageUrl -Headers @{ Authorization = "Bearer $accessToken" }
}
$creatorPageStats = Measure-Endpoint -Name "creator_page" -Call $creatorPageCall -N $Iterations

$resultsObj = [ordered]@{
  meta = [ordered]@{
    ts = (Get-Date).ToString("o")
    branch = $Branch
    surface = $SurfaceName
    iterations = $Iterations
    account_id = $accountId
    access_token_redacted = $accessTokenRedacted
    linkCode_surface = $linkCodeFromSurface
    linkCode_search = $linkCodeFromSearch
    creator_account_id = $creatorAccountId
  }
  endpoints = @(
    $discTokStats,
    $surfaceStats,
    $pageStats,
    $linkEntriesStats,
    $searchLinksStats,
    $searchCreatorsStats,
    $creatorPageStats
  )
}

$outDir = Join-Path $PSScriptRoot "_out"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "epic_discovery_smoke_results.json"
($resultsObj | ConvertTo-Json -Depth 8) | Set-Content -Encoding UTF8 -Path $outPath

Write-Host ""
Write-Host "Resumo (p50/p95 em ms):"
$resultsObj.endpoints | ForEach-Object {
  Write-Host ("- {0}: {1}% ok | p50 {2} | p95 {3} | last HTTP {4}" -f $_.name, $_.success_rate, $_.p50_ms, $_.p95_ms, $_.last_status)
}
Write-Host ""
Write-Host ("Output JSON: {0}" -f $outPath)
