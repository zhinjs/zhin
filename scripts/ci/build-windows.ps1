param(
  [string]$ProjectRoot = (Join-Path $PSScriptRoot '../..')
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$diagnostics = Join-Path $ProjectRoot '.tmp/ci'
New-Item -ItemType Directory -Force -Path $diagnostics | Out-Null
$samples = [System.Collections.Generic.List[object]]::new()
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source

# One pnpm orchestrator, rather than Turbo spawning pnpm + cmd for every package.
# Recursive run preserves dependency order, all three build scopes, and failure exits.
$arguments = Get-Content (Join-Path $PSScriptRoot 'windows-build-args.json') -Raw | ConvertFrom-Json
$build = Start-Process -FilePath $pnpm -ArgumentList $arguments -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru
try {
  # Retain the handle before the process can exit, so a fast failure still has
  # a readable exit code after Refresh/WaitForExit.
  $null = $build.Handle
  do {
    $processes = @(Get-Process -ErrorAction SilentlyContinue)
    $samples.Add([pscustomobject]@{
      elapsedSeconds = [math]::Round($clock.Elapsed.TotalSeconds, 1)
      processes = $processes.Count
      node = @($processes | Where-Object ProcessName -eq 'node').Count
      cmd = @($processes | Where-Object ProcessName -eq 'cmd').Count
      conhost = @($processes | Where-Object ProcessName -eq 'conhost').Count
      handles = ($processes | Measure-Object HandleCount -Sum).Sum
      workingSetBytes = ($processes | Measure-Object WorkingSet64 -Sum).Sum
    })
    $build.WaitForExit(2000) | Out-Null
    $build.Refresh()
  } until ($build.HasExited)
  $build.WaitForExit()
  $exitCode = $build.ExitCode
  if ($null -eq $exitCode) { throw 'Windows build exited without a readable exit code.' }
} finally {
  $peaks = [ordered]@{}
  foreach ($metric in @('processes', 'node', 'cmd', 'conhost', 'handles', 'workingSetBytes')) {
    $peaks[$metric] = ($samples | Measure-Object -Property $metric -Maximum).Maximum
  }
  # Write the small summary from this live PowerShell process. A poisoned runner
  # may be unable to start the Node action which uploads the full sample file.
  $summary = [pscustomobject]@{
    image = $env:ImageOS
    imageVersion = $env:ImageVersion
    nodeVersion = $env:CI_NODE_VERSION
    exitCode = $build.ExitCode
    sampleCount = $samples.Count
    sampledPeaks = $peaks
  }
  Write-Host ('[windows-build] ' + ($summary | ConvertTo-Json -Depth 3 -Compress))
  [pscustomobject]@{
    image = $env:ImageOS
    imageVersion = $env:ImageVersion
    nodeVersion = $env:CI_NODE_VERSION
    exitCode = $build.ExitCode
    sampledPeaks = $peaks
    samples = $samples.ToArray()
  } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $diagnostics 'windows-build-resources.json')
  $build.Dispose()
}

# A compiler/build failure remains a failure. Retrying on a poisoned runner
# cannot restore the ability to spawn processes.
exit $exitCode
