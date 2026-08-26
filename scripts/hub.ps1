#Requires -Version 5.1
<#
  hub.ps1 — claude-hub (GitHub-as-a-database) plumbing.

  Every skill calls this instead of running raw git, so that the
  rebase/retry behaviour is identical across all parallel windows.
  File *writing* is deliberately not handled here — Claude writes files
  with its own tools; this script owns only git and read helpers.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
$HubRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Git {
  param([string[]]$GitArgs, [switch]$AllowFail)
  # PowerShell 5.1 turns a native exe's stderr into a terminating NativeCommandError
  # under `2>&1`; dropping to Continue for the call keeps the text and the exit code.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & git -C $HubRoot @GitArgs 2>&1 | ForEach-Object { [string]$_ }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0 -and -not $AllowFail) {
    throw "git $($GitArgs -join ' ') failed ($code):`n$($out -join "`n")"
  }
  [pscustomobject]@{ Code = $code; Output = ($out -join "`n") }
}

function Test-HasRemote {
  [bool]((Invoke-Git @('remote') -AllowFail).Output -match '\S')
}

function Resolve-HubPath {
  param([string]$Relative)
  if ([string]::IsNullOrWhiteSpace($Relative)) { throw 'A path inside the hub is required.' }
  $full = [System.IO.Path]::GetFullPath((Join-Path $HubRoot $Relative))
  $root = [System.IO.Path]::GetFullPath($HubRoot)
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch '$Relative' - it escapes the hub root."
  }
  $full
}

function Sync-Hub {
  if (-not (Test-HasRemote)) { Write-Host 'no remote configured - local only'; return }
  $r = Invoke-Git @('pull', '--rebase', '--autostash') -AllowFail
  if ($r.Code -ne 0) {
    Invoke-Git @('rebase', '--abort') -AllowFail | Out-Null
    throw "pull --rebase failed. Resolve by hand in $HubRoot`n$($r.Output)"
  }
  Write-Host $r.Output
}

function Save-Hub {
  param([string]$Message)
  if ([string]::IsNullOrWhiteSpace($Message)) { $Message = 'hub: update' }

  Invoke-Git @('add', '-A') | Out-Null
  $hasStaged = (Invoke-Git @('diff', '--cached', '--quiet') -AllowFail).Code -ne 0
  if ($hasStaged) {
    Invoke-Git @('commit', '-m', $Message) | Out-Null
    Write-Host "committed: $Message"
  } else {
    Write-Host 'nothing to commit'
  }

  if (-not (Test-HasRemote)) { Write-Host 'no remote - commit stays local'; return }

  # Parallel windows race on push; rebase-and-retry absorbs the collision.
  for ($i = 1; $i -le 4; $i++) {
    $push = Invoke-Git @('push') -AllowFail
    if ($push.Code -eq 0) { Write-Host 'pushed'; return }
    Write-Host "push rejected (attempt $i) - rebasing onto remote"
    $pull = Invoke-Git @('pull', '--rebase', '--autostash') -AllowFail
    if ($pull.Code -ne 0) {
      Invoke-Git @('rebase', '--abort') -AllowFail | Out-Null
      throw "Rebase conflict during save. Resolve by hand in $HubRoot`n$($pull.Output)"
    }
    Start-Sleep -Milliseconds (200 * $i)
  }
  throw 'push failed after 4 attempts.'
}

switch ($Command.ToLowerInvariant()) {
  'root' { Write-Output $HubRoot }
  'sync' { Sync-Hub }
  'save' { Save-Hub -Message ($Rest -join ' ') }

  'get' {
    $p = Resolve-HubPath $Rest[0]
    if (-not (Test-Path -LiteralPath $p)) { Write-Host "(not found: $($Rest[0]))" }
    else { Get-Content -LiteralPath $p -Raw -Encoding UTF8 }
  }

  'list' {
    $rel = if ($Rest.Count -gt 0 -and $Rest[0]) { $Rest[0] } else { '.' }
    $p = Resolve-HubPath $rel
    if (-not (Test-Path -LiteralPath $p)) { Write-Host "(not found: $rel)" }
    else {
      Get-ChildItem -LiteralPath $p -Recurse -File |
        Where-Object { $_.FullName -notmatch '\\.git\' } |
        ForEach-Object { $_.FullName.Substring($HubRoot.Length + 1).Replace('\', '/') } |
        Sort-Object
    }
  }

  'status' {
    Write-Host "hub root : $HubRoot"
    $branch = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD') -AllowFail)
    Write-Host "branch   : $(if ($branch.Code -eq 0) { $branch.Output } else { '(no commits yet)' })"
    $remote = (Invoke-Git @('remote', '-v') -AllowFail).Output
    Write-Host "remote   : $(if ($remote -match '\S') { ($remote -split "`n")[0] } else { '(none)' })"
    Write-Host '--- working tree ---'
    $st = (Invoke-Git @('status', '--short') -AllowFail).Output
    Write-Host $(if ($st -match '\S') { $st } else { 'clean' })
  }

  default {
    @'
hub.ps1 <command>

  status            hub root, branch, remote, dirty files
  sync              git pull --rebase --autostash
  save <message>    add -A, commit, push with rebase-retry (safe in parallel windows)
  get <path>        print a file inside the hub
  list [dir]        list files under the hub, as hub-relative paths
  root              print the hub root path

Write files with your normal file tools, then call `save`.
Paths are hub-relative and may not escape the hub root.
'@ | Write-Output
  }
}
