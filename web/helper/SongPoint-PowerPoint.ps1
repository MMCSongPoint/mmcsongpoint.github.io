# SongPoint PowerPoint helper (Windows, on the computer that runs the projector).
# Lets SongPoint's presenter play a speaker's slides in real PowerPoint: open the file as a full-screen slideshow,
# go forward / back, black screen, and end the show. It only listens on this computer (127.0.0.1) and only takes
# requests from the SongPoint web app. Leave this window open while presenting; close it to stop.
$ErrorActionPreference = 'Stop'
$Port = 47321
$Allowed = @('https://mmcsongpoint.github.io', 'http://localhost:8090')
$Dir = Join-Path $env:TEMP 'SongPoint slides'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$script:ppt = $null; $script:pres = $null; $script:presId = ''; $script:presName = ''

function Get-Ppt {
  try { if ($script:ppt) { $null = $script:ppt.Version; return $script:ppt } } catch { $script:ppt = $null }
  $script:ppt = New-Object -ComObject PowerPoint.Application
  return $script:ppt
}
function Get-View {
  try { if ($script:pres -and $script:pres.SlideShowWindow) { return $script:pres.SlideShowWindow.View } } catch {}
  return $null
}
function Get-State {
  $v = Get-View; $total = 0
  try { if ($script:pres) { $total = $script:pres.Slides.Count } } catch {}
  if ($v) {
    $slide = 0; try { $slide = $v.Slide.SlideIndex } catch { try { $slide = $v.CurrentShowPosition } catch {} }
    $st = 1; try { $st = $v.State } catch {}
    return @{ ok = $true; app = 'songpoint-ppt'; v = 1; running = $true; id = $script:presId; name = $script:presName; slide = $slide; total = $total; black = ($st -eq 3); done = ($st -eq 5) }
  }
  return @{ ok = $true; app = 'songpoint-ppt'; v = 1; running = $false; id = $script:presId; name = $script:presName; slide = 0; total = $total; black = $false; done = $false }
}
function Close-Pres {
  try { $v = Get-View; if ($v) { $v.Exit() } } catch {}
  try { if ($script:pres) { $script:pres.Close() } } catch {}
  $script:pres = $null; $script:presId = ''; $script:presName = ''
}
function Open-Show([string]$id, [string]$name, [byte[]]$body) {
  $ext = [IO.Path]::GetExtension($name).ToLower(); if ($ext -notin @('.pptx', '.ppt', '.ppsx', '.pps')) { $ext = '.pptx' }
  $safe = ($id -replace '[^\w-]', '')
  if (-not $safe) { throw 'No file id' }
  $path = Join-Path $Dir ($safe + $ext)
  if ($body -and $body.Length) { [IO.File]::WriteAllBytes($path, $body) }
  if (-not (Test-Path $path)) { return @{ ok = $false; need = 'file' } }
  if ($script:presId -ne $safe -or -not $script:pres) {
    Close-Pres
    $app = Get-Ppt
    $script:pres = $app.Presentations.Open($path, -1, 0, 0)   # read-only, no editing window
    $script:presId = $safe; $script:presName = $name
  }
  $v = Get-View
  if ($v) { try { $v.GotoSlide(1) } catch {} ; try { $v.State = 1 } catch {} }
  else {
    $ss = $script:pres.SlideShowSettings
    $ss.ShowType = 1                       # full screen (on PowerPoint's slide show monitor)
    $ss.StartingSlide = 1; $ss.EndingSlide = $script:pres.Slides.Count; $ss.RangeType = 2
    $null = $ss.Run()
  }
  try { $script:pres.SlideShowWindow.Activate() } catch {}
  return Get-State
}

function Send-Response($stream, [int]$code, $obj, [string]$origin) {
  $json = ($obj | ConvertTo-Json -Compress -Depth 4)
  $bytes = [Text.Encoding]::UTF8.GetBytes($json); if ($code -eq 204) { $bytes = [byte[]]@() }
  $status = if ($code -eq 200) { 'OK' } elseif ($code -eq 204) { 'No Content' } elseif ($code -eq 403) { 'Forbidden' } else { 'Error' }
  $h = "HTTP/1.1 $code $status`r`nContent-Type: application/json`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n"
  if ($origin) { $h += "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n" }
  $hb = [Text.Encoding]::ASCII.GetBytes($h + "`r`n")
  $stream.Write($hb, 0, $hb.Length); if ($code -ne 204) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}
function Read-Request($stream) {
  # headers: byte by byte up to the blank line
  $buf = New-Object System.Collections.Generic.List[byte]; $one = New-Object byte[] 1
  while ($true) {
    $n = $stream.Read($one, 0, 1); if ($n -le 0) { return $null }
    $buf.Add($one[0])
    $c = $buf.Count
    if ($c -ge 4 -and $buf[$c-4] -eq 13 -and $buf[$c-3] -eq 10 -and $buf[$c-2] -eq 13 -and $buf[$c-1] -eq 10) { break }
    if ($c -gt 65536) { return $null }
  }
  $lines = [Text.Encoding]::ASCII.GetString($buf.ToArray()) -split "`r`n"
  $first = $lines[0] -split ' '
  $hdr = @{}
  foreach ($l in $lines[1..($lines.Count - 1)]) { $i = $l.IndexOf(':'); if ($i -gt 0) { $hdr[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
  $len = 0; if ($hdr['content-length']) { $len = [int]$hdr['content-length'] }
  $body = New-Object byte[] $len; $got = 0
  while ($got -lt $len) { $n = $stream.Read($body, $got, $len - $got); if ($n -le 0) { break }; $got += $n }
  $path = $first[1]; $q = @{}
  $qi = $path.IndexOf('?')
  if ($qi -ge 0) {
    foreach ($kv in ($path.Substring($qi + 1) -split '&')) {
      $p = $kv -split '=', 2
      if ($p[0]) { $k = [Uri]::UnescapeDataString($p[0]); $val = ([string]$p[1]).Replace('+', ' '); $q[$k] = [Uri]::UnescapeDataString($val) }
    }
    $path = $path.Substring(0, $qi)
  }
  return @{ method = $first[0]; path = $path; query = $q; headers = $hdr; body = $body }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { Write-Host "Couldn't start: is the helper already running? ($($_.Exception.Message))"; Read-Host 'Press Enter to close'; exit 1 }
Write-Host ''
Write-Host '  SongPoint PowerPoint helper is running.' -ForegroundColor Green
Write-Host '  Leave this window open while presenting (you can minimize it). Close it to stop.'
Write-Host ''
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 30000
    $stream = $client.GetStream()
    $req = Read-Request $stream
    if (-not $req) { continue }
    $origin = $req.headers['origin']
    $okOrigin = $origin -and ($Allowed -contains $origin)
    if ($origin -and -not $okOrigin) { Send-Response $stream 403 @{ ok = $false; error = 'Not allowed' } ''; continue }
    if ($req.method -eq 'OPTIONS') { Send-Response $stream 204 @{} $origin; continue }
    $res = $null
    try {
      switch ($req.path) {
        '/status' { $res = Get-State }
        '/open'   { $res = Open-Show $req.query['id'] $req.query['name'] $req.body; Write-Host "  Showing: $($req.query['name'])" }
        '/next'   { $v = Get-View; if ($v) { $v.Next() }; $res = Get-State }
        '/prev'   { $v = Get-View; if ($v) { $v.Previous() }; $res = Get-State }
        '/black'  { $v = Get-View; if ($v) { if ($v.State -eq 3) { $v.State = 1 } else { $v.State = 3 } }; $res = Get-State }
        '/end'    { Close-Pres; $res = Get-State }
        default   { $res = @{ ok = $false; error = 'Unknown request' } }
      }
    } catch { $res = @{ ok = $false; error = $_.Exception.Message } }
    Send-Response $stream 200 $res $origin
  } catch { Write-Host "  (request failed: $($_.Exception.Message))" } finally { try { $client.Close() } catch {} }
}
