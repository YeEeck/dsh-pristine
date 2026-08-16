<#
Install the Pristine preset into the DeepSeek Harness user preset root.

  .\install.ps1           snapshot copy (default)
  .\install.ps1 -Link     symlink (requires Developer Mode)

The preset root resolves from $env:DSH_HOME (default %USERPROFILE%\.dsh):
  $env:DSH_HOME\.agent-presets\pristine\
#>
[CmdletBinding()]
param(
    [switch]$Link,
    [Alias('h')]
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

$PresetId = 'pristine'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PresetSrc = Join-Path $ScriptDir 'preset'
if (-not $env:USERPROFILE) { $env:USERPROFILE = [Environment]::GetFolderPath('UserProfile') }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$PresetRoot = Join-Path $DshHome '.agent-presets'
$Target = Join-Path $PresetRoot $PresetId
$PresetFiles = @('agent.cordis.yml', 'preset.yml', 'warmup-bootstrap.mjs', 'windows-shell.mjs', 'windows-subprocess.mjs')

if ($Help) {
    Write-Host @"
Usage: .\install.ps1 [-Link] [-Help]

Install the Pristine preset under $PresetRoot.

Options:
  -Link   Symlink preset\ into the preset root instead of copying, so
          git pull updates take effect immediately (requires Developer Mode).
  -Help   Show this help.
"@
    exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $PresetSrc 'agent.cordis.yml'))) {
    Write-Error 'preset\agent.cordis.yml not found next to this script'
}

function Test-PresetEntry([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return $true }
    $Parent = Split-Path -Parent $Path
    $Leaf = Split-Path -Leaf $Path
    if (Test-Path -LiteralPath $Parent) {
        return [bool](Get-ChildItem -LiteralPath $Parent -Force -ErrorAction SilentlyContinue | Where-Object Name -eq $Leaf)
    }
    return $false
}

function Test-SameFiles([string]$A, [string]$B) {
    foreach ($Name in $PresetFiles) {
        $HashA = (Get-FileHash -LiteralPath (Join-Path $A $Name) -Algorithm MD5).Hash
        $HashB = (Get-FileHash -LiteralPath (Join-Path $B $Name) -Algorithm MD5).Hash
        if ($HashA -ne $HashB) { return $false }
    }
    return $true
}

if (Test-PresetEntry $Target) {
    if ((Test-Path -LiteralPath $Target) -and (Test-SameFiles $PresetSrc $Target)) {
        Write-Host "Pristine preset is already installed at $Target"
        exit 0
    }
    Write-Error "Preset already exists and differs: $Target (run .\uninstall.ps1 first)"
}

New-Item -ItemType Directory -Force -Path $PresetRoot | Out-Null

if ($Link) {
    try {
        New-Item -ItemType SymbolicLink -Path $Target -Target $PresetSrc | Out-Null
        $Mode = 'link'
    } catch {
        Write-Warning 'Symlink failed (Developer Mode required); falling back to a copy.'
        Copy-Item -Recurse -LiteralPath $PresetSrc -Destination $Target
        $Mode = 'copy'
    }
} else {
    Copy-Item -Recurse -LiteralPath $PresetSrc -Destination $Target
    $Mode = 'copy'
}

foreach ($File in $PresetFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Target $File))) {
        Write-Error "verification failed: $File missing after install"
    }
}

Write-Host "installed Pristine preset at $Target ($Mode)"
Write-Host "next: fully restart DeepSeek Harness, create a blank session, and select 'Pristine'"
