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
Start-Sleep -Milliseconds 200
# replay main module import to surface the boot error
$probe = @'
(function(){
  try {
    var scripts = [].map.call(document.querySelectorAll('script'), function(s){return s.src || 'inline'});
    return JSON.stringify({scripts: scripts});
  } catch(e) { return 'ERR:'+e.message }
})()
'@
Send('{"id":2,"method":"Runtime.evaluate","params":{"expression":' + ($probe | ConvertTo-Json) + ',"returnByValue":true}}')
# rethrow last error by evaluating a dynamic import of the entry chunk
$imp = @'
import('/assets/' + [].map.call(document.querySelectorAll('script[src]'), function(s){ return (s.src.split('/').pop()) })[0]).then(function(m){ return 'IMPORT-OK' }).catch(function(e){ return 'IMPORT-FAIL: ' + (e && e.message) })
'@
Send('{"id":3,"method":"Runtime.evaluate","params":{"expression":' + ($imp | ConvertTo-Json) + ',"awaitPromise":true,"returnByValue":true}}')
$deadline = (Get-Date).AddSeconds(20)
$seen2 = $false; $seen3 = $false
while ((Get-Date) -lt $deadline -and -not ($seen2 -and $seen3)) {
  try { $msg = Recv } catch { break }
  if ($msg -match '"id":2') { Write-Output ("SCRIPTS: " + $msg); $seen2 = $true }
  if ($msg -match '"id":3') { Write-Output ("IMPORT: " + $msg.Substring(0, [Math]::Min(900, $msg.Length))); $seen3 = $true }
  if ($msg -match 'exceptionThrown') { Write-Output ("EXC: " + $msg.Substring(0, [Math]::Min(500, $msg.Length))) }
}
