<#
  SongPoint: save every song's slides as pictures, using PowerPoint on this computer.

  Reads the PowerPoints in  My Drive\SongPoint\Song Slides\<book>\...
  Writes                    My Drive\SongPoint\Slide Images\<book>\<song>\slide-01.png, slide-02.png, ... + slides.json
  Google Drive for desktop then uploads them. No Google limits, nothing to sign in to.

  Songs that already have up-to-date pictures are skipped, so it can be stopped (close the window)
  and started again any time; it carries on where it left off.

  Needs: Windows, Microsoft PowerPoint, and Google Drive for desktop with My Drive on this computer.

  Options (all optional):
    -Drive  "H:\My Drive"   where My Drive is (found by itself if left out)
    -Width  1600            picture width in pixels
    -Limit  10              only do this many songs (to try it out)
    -Book   "SFP"           only this book (the folder name in Song Slides)
    -Force                  make them all again, even the up-to-date ones
#>
param(
  [string]$Drive = '',
  [int]$Width = 1600,
  [int]$Limit = 0,
  [string]$Book = '',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Find-MyDrive {
  foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
    if (-not $d.IsReady) { continue }
    foreach ($n in 'My Drive', 'Mi unidad', 'Meine Ablage') {
      $p = Join-Path $d.RootDirectory.FullName $n
      if (Test-Path (Join-Path $p 'SongPoint\Song Slides')) { return $p }
    }
  }
  return $null
}
if (-not $Drive) { $Drive = Find-MyDrive }
if (-not $Drive -or -not (Test-Path (Join-Path $Drive 'SongPoint\Song Slides'))) {
  Write-Host "Couldn't find My Drive\SongPoint\Song Slides on this computer." -ForegroundColor Red
  Write-Host 'Make sure Google Drive for desktop is running, or give the place with -Drive "H:\My Drive".'
  exit 1
}
$src  = Join-Path $Drive 'SongPoint\Song Slides'
$dest = Join-Path $Drive 'SongPoint\Slide Images'
$logDir = Join-Path $env:LOCALAPPDATA 'SongPoint helper'
New-Item -ItemType Directory -Force -Path $dest, $logDir | Out-Null
$log = Join-Path $logDir 'slide-pictures-log.txt'
function Log($msg, $color = 'Gray') { $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg; Write-Host $msg -ForegroundColor $color; Add-Content -Path $log -Value $line -Encoding UTF8 }
function Clean($s) { (($s -replace '[\\/:*?"<>|]+', ' ') -replace '\s+', ' ').Trim() }

# Every PowerPoint, with its book (the first folder under Song Slides; "Other" for ones not in a folder)
$decks = Get-ChildItem -Path $src -Recurse -File -Include *.ppt, *.pptx | Where-Object { $_.Name -notlike '~$*' } | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length).TrimStart('\')
  $parts = $rel.Split('\')
  [pscustomobject]@{ File = $_; Book = $(if ($parts.Count -gt 1) { $parts[0] } else { 'Other' }) }
} | Sort-Object { $_.Book }, { $_.File.Name }
if ($Book) { $decks = @($decks | Where-Object { $_.Book -eq $Book }) }
Log ("Found {0} PowerPoints in {1}" -f $decks.Count, $src) 'Cyan'

function Up-To-Date($outDir, $updated) {
  $j = Join-Path $outDir 'slides.json'
  if (-not (Test-Path $j)) { return $false }
  try { $info = Get-Content $j -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $false }
  $pngs = @(Get-ChildItem -Path $outDir -Filter 'slide-*.png' -File -ErrorAction SilentlyContinue).Count
  return ([int64]$info.updated -ge ($updated - 5000)) -and ($pngs -eq [int]$info.count) -and ($pngs -gt 0)
}

$pp = $null
function Start-PowerPoint { $script:pp = New-Object -ComObject PowerPoint.Application }
function Wait-NotPresenting {
  # don't get in the way of a slideshow on the projector
  $said = $false
  while ($true) {
    $busy = $false; try { $busy = $script:pp.SlideShowWindows.Count -gt 0 } catch { Start-PowerPoint }
    if (-not $busy) { return }
    if (-not $said) { Log 'A slideshow is running: waiting until it ends…' 'Yellow'; $said = $true }
    Start-Sleep -Seconds 30
  }
}
Start-PowerPoint

$made = 0; $skipped = 0; $failed = 0; $n = 0; $t0 = Get-Date
foreach ($d in $decks) {
  $n++
  $f = $d.File
  $title = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  $outDir = Join-Path (Join-Path $dest (Clean $d.Book)) (Clean $title)
  $updated = [DateTimeOffset]::new($f.LastWriteTimeUtc).ToUnixTimeMilliseconds()
  if (-not $Force -and (Up-To-Date $outDir $updated)) { $skipped++; continue }
  if ($Limit -and $made + $failed -ge $Limit) { break }
  Write-Progress -Activity 'Saving slides as pictures' -Status ("{0} of {1}: {2} › {3}" -f $n, $decks.Count, $d.Book, $title) -PercentComplete ([int](100 * $n / [math]::Max(1, $decks.Count)))
  Wait-NotPresenting
  $tmp = Join-Path $env:TEMP ('songpoint-slides-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $pres = $null
  try {
    # read-only, no window
    $pres = $pp.Presentations.Open($f.FullName, -1, 0, 0)
    $sw = $pres.PageSetup.SlideWidth; $sh = $pres.PageSetup.SlideHeight
    $h = [int][math]::Round($Width * $sh / $sw)
    $texts = New-Object System.Collections.Generic.List[string]
    $notes = New-Object System.Collections.Generic.List[string]
    $i = 0
    foreach ($s in $pres.Slides) {
      $i++
      $s.Export((Join-Path $tmp ('slide-{0:D2}.png' -f $i)), 'PNG', $Width, $h)
      $t = @(); foreach ($sp in $s.Shapes) { try { if ($sp.HasTextFrame -and $sp.TextFrame.HasText) { $x = $sp.TextFrame.TextRange.Text.Trim(); if ($x) { $t += $x } } } catch {} }
      $texts.Add(((($t -join "`n") -replace "`r", "`n")))
      $note = ''; try { $note = $s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text.Trim() } catch {}
      $notes.Add(($note -replace "`r", "`n"))
    }
    $pres.Close(); $pres = $null
    $json = [ordered]@{ name = $title; book = $d.Book; file = $f.Name; updated = $updated; count = $i; width = $Width; height = $h; texts = $texts.ToArray(); notes = $notes.ToArray(); madeBy = 'PowerPoint'; made = (Get-Date).ToUniversalTime().ToString('o') }
    [IO.File]::WriteAllText((Join-Path $tmp 'slides.json'), ($json | ConvertTo-Json -Depth 4 -Compress), $utf8)
    # swap the new pictures in (old ones go to Drive's trash)
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    Get-ChildItem -Path $outDir -File | Where-Object { $_.Name -like 'slide-*.png' -or $_.Name -eq 'slides.json' } | Remove-Item -Force
    Get-ChildItem -Path $tmp -File | Move-Item -Destination $outDir -Force
    $made++
    Log ("[{0}/{1}] {2} › {3}: {4} slides" -f $n, $decks.Count, $d.Book, $title, $i) 'Green'
  } catch {
    $failed++
    Log ("[{0}/{1}] {2} › {3}: FAILED: {4}" -f $n, $decks.Count, $d.Book, $title, $_.Exception.Message) 'Red'
    if ($pres) { try { $pres.Close() } catch {} }
    # PowerPoint may have got stuck: start it again
    try { $null = $pp.Presentations.Count } catch { Start-PowerPoint }
  } finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (($made + $failed) % 150 -eq 0 -and $pp.Presentations.Count -eq 0 -and $pp.SlideShowWindows.Count -eq 0) {
    # a fresh PowerPoint now and then keeps memory down (only if nothing else is open in it)
    try { $pp.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp); [GC]::Collect(); Start-Sleep 2; Start-PowerPoint
  }
}
Write-Progress -Activity 'Saving slides as pictures' -Completed
$mins = [int]((Get-Date) - $t0).TotalMinutes
Log ("Done in {0} min: {1} made, {2} already up to date, {3} failed. Log: {4}" -f $mins, $made, $skipped, $failed, $log) 'Cyan'
if ($failed) { Log 'Run it again to retry the ones that failed.' 'Yellow' }
