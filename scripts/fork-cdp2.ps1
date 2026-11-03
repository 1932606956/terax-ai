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
# collect console errors + React root state
$expr = @'
(function(){
  var out = {errs: []};
  window.__cdpErrs = window.__cdpErrs || [];
  out.errs = window.__cdpErrs.slice(0, 10);
  var root = document.getElementById('root');
  out.rootChildren = root ? root.children.length : -1;
  out.rootLen = root ? root.innerHTML.length : -1;
  out.hasReact = !!(window.React || document.querySelector('[data-reactroot], #root > *'));
  return JSON.stringify(out);
})()
'@
Send('{"id":1,"method":"Runtime.enable","params":{}}')
Start-Sleep -Milliseconds 300
Send('{"id":2,"method":"Runtime.evaluate","params":{"expression":' + ($expr | ConvertTo-Json) + ',"returnByValue":true}}')
$deadline = (Get-Date).AddSeconds(6)
while ((Get-Date) -lt $deadline) {
  try { $msg = Recv } catch { break }
  if ($msg -match '"id":2') { Write-Output $msg; break }
  if ($msg -match 'exceptionThrown|errorOccurred') { Write-Output ("CONSOLE: " + $msg.Substring(0, [Math]::Min(600, $msg.Length))) }
}
