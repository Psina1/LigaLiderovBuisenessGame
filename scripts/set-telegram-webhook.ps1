param(
  [Parameter(Mandatory = $true)]
  [string] $BotToken,

  [Parameter(Mandatory = $true)]
  [string] $BaseUrl,

  [string] $SecretToken = ""
)

$webhookUrl = $BaseUrl.TrimEnd("/") + "/api/telegram/webhook"
$body = @{
  url = $webhookUrl
  allowed_updates = @("message", "callback_query")
}

if ($SecretToken) {
  $body.secret_token = $SecretToken
}

$response = Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$BotToken/setWebhook" `
  -ContentType "application/json" `
  -Body ($body | ConvertTo-Json -Depth 5)

$response | ConvertTo-Json -Depth 5
