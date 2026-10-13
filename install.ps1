# Registers this repo as the local "claude-code-mods" plugin marketplace and
# installs every plugin it lists at user scope. Safe to run again.
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File <repo>\install.ps1

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$marketplace = 'claude-code-mods'

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw 'claude CLI not found. Install Claude Code first.'
}

$known = (claude plugin marketplace list) -join "`n"
if ($known -match [regex]::Escape($marketplace)) {
    Write-Host "Marketplace $marketplace already added; refreshing."
    claude plugin marketplace update $marketplace
} else {
    claude plugin marketplace add $repo
}

$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repo '.claude-plugin\marketplace.json') | ConvertFrom-Json
foreach ($plugin in $manifest.plugins) {
    Write-Host "Installing $($plugin.name)@$marketplace"
    claude plugin install "$($plugin.name)@$marketplace" --scope user
}

Write-Host 'Done. Restart Claude Code or run /reload-plugins in a running session.'
