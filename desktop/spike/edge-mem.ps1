$ErrorActionPreference = 'SilentlyContinue'
$before = @(Get-Process msedge | Select-Object -ExpandProperty Id)
$dir = Join-Path $env:TEMP "bsub-edge-compare"
Remove-Item $dir -Recurse -Force
$edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe" }
if (-not (Test-Path $edge)) { Write-Output "EDGE_NOT_FOUND"; exit 1 }
Start-Process -FilePath $edge -ArgumentList "--user-data-dir=`"$dir`"", "--no-first-run", "--disable-sync", "--app=https://www.bilibili.com/video/BV1xrnz6gEVD"
Start-Sleep -Seconds 25
$new = @(Get-Process msedge | Where-Object { $before -notcontains $_.Id })
$sum = ($new | Measure-Object WorkingSet64 -Sum).Sum
Write-Output ("pids={0} totalMB={1}" -f $new.Count, [math]::Round($sum / 1MB, 0))
$new | ForEach-Object { Stop-Process -Id $_.Id -Force }
Remove-Item $dir -Recurse -Force
