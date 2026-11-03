param()
$pages = (Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json' -UseBasicParsing).Content | ConvertFrom-Json
$page = $pages | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
$ws = $page.webSocketDebuggerUrl
$c = New-Object System.Net.WebSockets.ClientWebSocket
$c.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
function Send([string]$s) {
  $b = [Text.Encoding]::UTF8.GetBytes($s)
  $c.SendAsync($b, 'Text', $true, [Threading.CancellationToken]::None).Wait(3000) | Out-Null
}
function Recv {
  $buf = New-Object byte[] 1048576
  $seg = [ArraySegment[byte]]::new($buf)
  $r = $c.ReceiveAsync($seg, [Threading.CancellationToken]::None).Result
  [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
}
Send('{"id":1,"method":"Runtime.enable"}')
Start-Sleep -Milliseconds 300
# wait for the app to mount, then probe repeatedly
for ($try = 1; $try -le 6; $try++) {
  Start-Sleep -Seconds 3
  $probe = @'
JSON.stringify({
  rootChildren: (document.getElementById('root')||{children:[]}).children.length,
  bodyText: document.body.innerText.slice(0, 120)
})
'@
  Send('{"id":9' + $try + ',"method":"Runtime.evaluate","params":{"expression":' + ($probe | ConvertTo-Json) + ',"returnByValue":true}}')
  $deadline = (Get-Date).AddSeconds(4)
  while ((Get-Date) -lt $deadline) {
    try { $msg = Recv } catch { break }
    if ($msg -match '"id":9' + $try) {
      Write-Output ("try" + $try + ": " + $msg.Substring(0, [Math]::Min(400, $msg.Length)))
      break
    }
    if ($msg -match 'exceptionThrown') {
      Write-Output ("EXC: " + $msg.Substring(0, [Math]::Min(400, $msg.Length)))
    }
  }
}
