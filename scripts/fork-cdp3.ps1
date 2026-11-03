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
# probe the page directly: any text? stylesheets? canvas? errors?
$probe = @'
JSON.stringify({
  ready: document.readyState,
  rootChildren: (document.getElementById('root')||{children:[]}).children.length,
  rootHtmlLen: (document.getElementById('root')||{innerHTML:''}).innerHTML.length,
  bodyText: document.body.innerText.slice(0, 200),
  sheets: document.styleSheets.length,
  canvas: document.querySelectorAll('canvas').length,
  bg: getComputedStyle(document.documentElement).backgroundColor,
  bodyBg: getComputedStyle(document.body).backgroundColor
})
'@
Send('{"id":9,"method":"Runtime.evaluate","params":{"expression":' + ($probe | ConvertTo-Json) + ',"returnByValue":true}}')
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline) {
  try { $msg = Recv } catch { break }
  if ($msg -match '"id":9') { Write-Output $msg; break }
}
