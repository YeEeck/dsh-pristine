<#
Remove the Pristine preset from the DeepSeek Harness user preset root.
#>
[CmdletBinding()]
param(
    [Alias('y')]
    [switch]$Yes,
    [Alias('h')]
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

$PresetId = 'pristine'
if (-not $env:USERPROFILE) { $env:USERPROFILE = [Environment]::GetFolderPath('UserProfile') }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$Target = Join-Path (Join-Path $DshHome '.agent-presets') $PresetId

if ($Help) {
    Write-Host @"
Usage: .\uninstall.ps1 [-Yes] [-Help]

Remove the Pristine preset from $Target.

Options:
  -Yes    Skip the confirmation prompt.
  -Help   Show this help.
"@
    exit 0
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

if (-not (Test-PresetEntry $Target)) {
    Write-Host "nothing to remove: $Target"
    exit 0
}

if (-not $Yes) {
    $Answer = Read-Host "remove $Target ? [y/N]"
    if ($Answer -notmatch '^(y|yes)$') { Write-Host 'aborted'; exit 0 }
}

if (Test-Path -LiteralPath $Target) {
    $Item = Get-Item -LiteralPath $Target -Force
    if ($Item.LinkType) {
        # Never recurse into a link: remove the link entry itself.
        Remove-Item -LiteralPath $Target -Force
    } else {
        Remove-Item -LiteralPath $Target -Recurse -Force
    }
} else {
    # Dangling link: remove the entry itself.
    Remove-Item -LiteralPath $Target -Force
}

Write-Host "removed $Target"
