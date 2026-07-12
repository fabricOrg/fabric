param(
  [Parameter(Mandatory = $true)]
  [string]$ApiKey,

  [Parameter(Mandatory = $true)]
  [string]$To,

  [Parameter(Mandatory = $true)]
  [string]$SenderId,

  [string]$Currency = "GHS",

  [string]$ApiBaseUrl = "https://d2umm5b2x22zvp.cloudfront.net",

  [string]$Body = "Fabric testing live SMS canary",

  [string]$IdempotencyKey = "testing-live-sms-canary-$(Get-Date -AsUTC -Format yyyyMMddHHmmss)"
)

$ErrorActionPreference = "Stop"

if ($To -notmatch '^\+[1-9]\d{7,14}$') {
  throw "To must be an E.164 phone number, for example +233XXXXXXXXX."
}

$headers = @{
  Authorization     = "Bearer $ApiKey"
  "Idempotency-Key" = $IdempotencyKey
}

$payload = @{
  to        = $To
  sender_id = $SenderId
  body      = $Body
  currency  = $Currency
  class     = "transactional"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$ApiBaseUrl/v1/sms/send" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $payload
