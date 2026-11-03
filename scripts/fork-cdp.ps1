param()
$pages = (Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json' -UseBasicParsing).Content | ConvertFrom-Json
$page = $pages | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
Write-Output ("title=[" + $page.title + "] url=" + $page.url)
$ws = $page.webSocketDebuggerUrl
$c = New-Object System.Net.WebSockets.ClientWebSocket
$c.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
function Send([string]$s) {
  $b = [Text.Encoding]::UTF8.GetBytes($s)
  $c.SendAsync($b, 'Text', $true, [Threading.CancellationToken]::None).Wait(3000) | Out-Null
}
function Recv {
  $buf = New-Object byte[] 262144
  $seg = [ArraySegment[byte]]::new($buf)
  $r = $c.ReceiveAsync($seg, [Threading.CancellationToken]::None).Result
  [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
}
$expr = "JSON.stringify({ready:document.readyState, bodyKids:(document.body?document.body.children.length:-1), root:(document.getElementById('root')?'has-root':'NO-ROOT'), rootHtml:(document.getElementById('root')||{innerHTML:''}).innerHTML.slice(0,400)})"
Send('{"id":1,"method":"Runtime.evaluate","params":{"expression":' + ($expr | ConvertTo-Json) + ',"returnByValue":true}}')
Write-Output (Recv)
