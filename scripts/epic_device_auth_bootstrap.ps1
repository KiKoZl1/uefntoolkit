param(
  [string]$ClientId = $env:EPIC_OAUTH_CLIENT_ID,
  [string]$ClientSecret = $env:EPIC_OAUTH_CLIENT_SECRET
)

$ErrorActionPreference = "Stop"

function Die($msg) { throw $msg }

if (-not $ClientId) { $ClientId = Read-Host "ClientId (ex: fortnitePCGameClient)" }
if (-not $ClientSecret) { $ClientSecret = Read-Host "ClientSecret" }

$code = Read-Host "Cole o authorizationCode (responseType=code)"
if (-not $code) { Die "authorizationCode vazio" }

$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$ClientId`:$ClientSecret"))

Write-Host "1) Trocando code -> token EG1..."
$tok = curl.exe -sS -X POST "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token" `
  -H "Authorization: Basic $basic" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data "grant_type=authorization_code&code=$code&token_type=eg1" | ConvertFrom-Json

if (-not $tok.access_token) { Die ("Falha no token: " + ($tok | ConvertTo-Json -Depth 6)) }

$accountId = [string]$tok.account_id
$accessToken = [string]$tok.access_token

Write-Host ("- account_id: {0}" -f $accountId)
Write-Host ("- access_token_len: {0}" -f $accessToken.Length)

Write-Host "2) Criando deviceAuth..."
$device = curl.exe -sS -X POST "https://account-public-service-prod.ol.epicgames.com/account/api/public/account/$accountId/deviceAuth" `
  -H "Authorization: Bearer $accessToken" `
  -H "Content-Type: application/json" `
  --data "{}" | ConvertFrom-Json

if (-not $device.deviceId -or -not $device.secret) {
  Die ("Falha ao criar deviceAuth: " + ($device | ConvertTo-Json -Depth 6))
}

Write-Host ""
Write-Host "Device Auth criado:"
$device | ConvertTo-Json -Depth 6

Write-Host ""
Write-Host "Env vars (Lovable/Supabase Secrets):"
Write-Host ("EPIC_OAUTH_CLIENT_ID={0}" -f $ClientId)
Write-Host ("EPIC_OAUTH_CLIENT_SECRET={0}" -f $ClientSecret)
Write-Host ("EPIC_DEVICE_AUTH_ACCOUNT_ID={0}" -f $accountId)
Write-Host ("EPIC_DEVICE_AUTH_DEVICE_ID={0}" -f $device.deviceId)
Write-Host ("EPIC_DEVICE_AUTH_SECRET={0}" -f $device.secret)

