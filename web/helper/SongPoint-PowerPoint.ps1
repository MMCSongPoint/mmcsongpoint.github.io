# SongPoint PowerPoint helper (Windows, on the computer that runs the projector).
# Lets SongPoint's presenter play a speaker's slides in real PowerPoint: open the file as a full-screen slideshow,
# go forward / back, black screen, and end the show. It only listens on this computer (127.0.0.1) and only takes
# requests from the SongPoint web app. Leave this window open while presenting; close it to stop.
param([switch]$Hidden)
$ErrorActionPreference = 'Stop'
$Port = 47321
$Allowed = @('https://mmcsongpoint.github.io', 'http://localhost:8090')
# Saved under Documents (not the Temp folder, which PowerPoint can treat as unsafe and open in Protected View)
$Docs = [Environment]::GetFolderPath('MyDocuments'); if (-not $Docs) { $Docs = $env:TEMP }
$Dir = Join-Path $Docs 'SongPoint slides'
$LogFile = Join-Path $Dir 'helper log.txt'
# Everything the helper reports goes to the window (if shown) and to "helper log.txt" next to the slides.
function Log([string]$m) {
  if (-not $Hidden) { Write-Host $m }
  try { Add-Content -Path $LogFile -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $m.Trim()) } catch {}
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
try { if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Remove-Item $LogFile } } catch {}

$script:ppt = $null; $script:pres = $null; $script:presId = ''; $script:presName = ''

# PowerPoint is driven through its COM automation interface. Every call goes through IDispatch by name (InvokeMember),
# so it works even when PowerShell can't read PowerPoint's type library (common with Microsoft 365 installs).
$BF = [Reflection.BindingFlags]
# (the leading comma stops PowerShell from unrolling a returned collection, e.g. Presentations, into its items)
function CGet($o, [string]$n) { if ($null -eq $o) { return $null }; return , ([System.__ComObject].InvokeMember($n, $BF::GetProperty, $null, $o, $null)) }
function CSet($o, [string]$n, $v) { [void][System.__ComObject].InvokeMember($n, $BF::SetProperty, $null, $o, @($v)) }
function CCall($o, [string]$n, [object[]]$a = @()) { return , ([System.__ComObject].InvokeMember($n, $BF::InvokeMethod, $null, $o, $a)) }
function CItems($coll) { $out = @(); $n = 0; try { $n = [int](CGet $coll 'Count') } catch {}; for ($i = 1; $i -le $n; $i++) { try { $out += , (CCall $coll 'Item' @($i)) } catch {} }; return , $out }

function Get-Ppt {
  try { if ($script:ppt) { $null = CGet $script:ppt 'Version'; return } } catch { $script:ppt = $null }
  try { $script:ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $script:ppt = $null }
  if (-not $script:ppt) { $script:ppt = New-Object -ComObject PowerPoint.Application }
  try { Log "  PowerPoint $(CGet $script:ppt 'Version') ready" } catch { Log "  PowerPoint: $($_.Exception.Message)" }
}
function Find-Pres([string]$path) {
  try { foreach ($x in (CItems (CGet $script:ppt 'Presentations'))) { if ((CGet $x 'FullName') -eq $path) { return $x } } } catch {}
  return $null
}
function Get-View {
  try { if ($script:pres) { $w = CGet $script:pres 'SlideShowWindow'; if ($w) { return (CGet $w 'View') } } } catch {}
  return $null
}
function Get-State {
  $v = Get-View; $total = 0
  try { if ($script:pres) { $total = [int](CGet (CGet $script:pres 'Slides') 'Count') } } catch {}
  if ($v) {
    $slide = 0; try { $slide = [int](CGet (CGet $v 'Slide') 'SlideIndex') } catch { try { $slide = [int](CGet $v 'CurrentShowPosition') } catch {} }
    $st = 1; try { $st = [int](CGet $v 'State') } catch {}
    return @{ ok = $true; app = 'songpoint-ppt'; v = 3; running = $true; id = $script:presId; name = $script:presName; slide = $slide; total = $total; black = ($st -eq 3); done = ($st -eq 5) }
  }
  return @{ ok = $true; app = 'songpoint-ppt'; v = 3; running = $false; id = $script:presId; name = $script:presName; slide = 0; total = $total; black = $false; done = $false }
}
function Close-Pres {
  try { $v = Get-View; if ($v) { [void](CCall $v 'Exit') } } catch {}
  try { if ($script:pres) { [void](CCall $script:pres 'Close') } } catch {}
  $script:pres = $null; $script:presId = ''; $script:presName = ''
}
function Ppt-Exe {
  try { $p = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\powerpnt.exe' -ErrorAction Stop).'(default)'; if ($p -and (Test-Path $p)) { return $p } } catch {}
  try { $p = Join-Path (CGet $script:ppt 'Path') 'POWERPNT.EXE'; if (Test-Path $p) { return $p } } catch {}
  return $null
}
function Open-Show([string]$id, [string]$name, [byte[]]$body, [string]$at) {
  if (-not $name) { $name = 'Slides.pptx' }
  $ext = [IO.Path]::GetExtension($name); if ($ext) { $ext = $ext.ToLower() }
  if ($ext -notin @('.pptx', '.ppt', '.ppsx', '.pps')) { $ext = '.pptx' }
  $safe = ($id -replace '[^\w-]', '')
  if (-not $safe) { throw 'No file id' }
  $path = Join-Path $Dir ($safe + $ext)
  if ($body -and $body.Length) { [IO.File]::WriteAllBytes($path, $body) }
  if (-not (Test-Path $path)) { return @{ ok = $false; need = 'file' } }
  $size = (Get-Item $path).Length
  $head = [IO.File]::ReadAllBytes($path)[0..3] | ForEach-Object { $_.ToString('X2') }
  Log "  File: $path ($size bytes, starts $($head -join ' '))"
  if ($size -lt 1000 -or (($head -join '') -notin @('504B0304', 'D0CF11E0'))) {
    Remove-Item $path -ErrorAction SilentlyContinue
    throw "The file SongPoint sent isn't a valid PowerPoint ($size bytes). Try again."
  }
  if ($script:presId -ne $safe -or -not $script:pres) {
    Close-Pres
    Get-Ppt
    try { CSet $script:ppt 'Visible' -1 } catch {}
    $p = Find-Pres $path
    if (-not $p) {
      try { $p = CCall (CGet $script:ppt 'Presentations') 'Open' @($path, -1, 0, -1) } catch { Log "  Open: $($_.Exception.InnerException.Message) $($_.Exception.Message)" }   # read-only, in a window
    }
    if (-not $p) {
      # Protected View (PowerPoint's read-only safety mode): take it out, the file came from SongPoint
      try { $pv = CItems (CGet $script:ppt 'ProtectedViewWindows'); if ($pv.Count) { $p = CCall $pv[$pv.Count - 1] 'Edit' } } catch { Log "  Protected View: $($_.Exception.Message)" }
    }
    if (-not $p) { $p = Find-Pres $path }
    if (-not $p) {
      # another way in: start the slideshow the way a double-click does (POWERPNT /S), then pick it up
      Log '  Trying PowerPoint /S...'
      try {
        $exe = Ppt-Exe
        if ($exe) { Start-Process -FilePath $exe -ArgumentList '/S', ('"' + $path + '"') } else { Start-Process -FilePath $path -Verb Show }
        for ($i = 0; $i -lt 40 -and -not $p; $i++) { Start-Sleep -Milliseconds 500; Get-Ppt; $p = Find-Pres $path }
      } catch { Log "  /S: $($_.Exception.Message)" }
    }
    if (-not $p) { throw "PowerPoint couldn't open the file (see the helper window for details): $path" }
    $script:pres = $p; $script:presId = $safe; $script:presName = $name
    try { $w = CItems (CGet $p 'Windows'); if ($w.Count) { CSet $w[0] 'WindowState' 2 } } catch {}   # keep the editing window out of the way
  }
  $v = Get-View
  if ($v) { try { [void](CCall $v 'GotoSlide' @(1)) } catch {}; try { CSet $v 'State' 1 } catch {} }
  else {
    $ss = CGet $script:pres 'SlideShowSettings'
    if (-not $ss) { throw 'PowerPoint opened the file but would not start the slideshow.' }
    try { CSet $ss 'ShowType' 1 } catch {}               # full screen (on PowerPoint's slide show monitor)
    try { CSet $ss 'RangeType' 1 } catch {}              # all slides
    [void](CCall $ss 'Run')
  }
  try { [void](CCall (CGet $script:pres 'SlideShowWindow') 'Activate') } catch {}
  if ($at -eq 'last') {   # stepping back into it from the next song: start on its last slide
    try { $t = [int](CGet (CGet $script:pres 'Slides') 'Count'); $v = Get-View; if ($v -and $t -gt 1) { [void](CCall $v 'GotoSlide' @($t)) } } catch { Log "  Last slide: $($_.Exception.Message)" }
  }
  Log "  Slideshow started"
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
try { $listener.Start() } catch { Log "Couldn't start: is the helper already running? ($($_.Exception.Message))"; if (-not $Hidden) { Read-Host 'Press Enter to close' }; exit 1 }
Log 'Helper started'
if (-not $Hidden) {
  Write-Host ''
  Write-Host '  SongPoint PowerPoint helper is running.' -ForegroundColor Green
  Write-Host '  Leave this window open while presenting (you can minimize it). Close it to stop.'
  Write-Host ''
}
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
        '/open'   { $res = Open-Show $req.query['id'] $req.query['name'] $req.body $req.query['at']; Log "  Showing: $($req.query['name'])" }
        '/next'   { $v = Get-View; if ($v) { [void](CCall $v 'Next') }; $res = Get-State }
        '/prev'   { $v = Get-View; if ($v) { [void](CCall $v 'Previous') }; $res = Get-State }
        '/black'  { $v = Get-View; if ($v) { if ([int](CGet $v 'State') -eq 3) { CSet $v 'State' 1 } else { CSet $v 'State' 3 } }; $res = Get-State }
        '/end'    { Close-Pres; $res = Get-State }
        default   { $res = @{ ok = $false; error = 'Unknown request' } }
      }
    } catch { $res = @{ ok = $false; error = $_.Exception.Message } }
    Send-Response $stream 200 $res $origin
  } catch { Log "  (request failed: $($_.Exception.Message))" } finally { try { $client.Close() } catch {} }
}
