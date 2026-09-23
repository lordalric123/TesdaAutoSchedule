$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) {
    Write-Host "No git repository detected in this folder."
    exit 1
}

$remote = git remote -v | Select-String "origin" -SimpleMatch
if (-not $remote) {
    Write-Host "No GitHub 'origin' remote is configured."
    Write-Host "Run: git remote add origin https://github.com/your-user/your-repo.git"
    exit 1
}

Write-Host "Getting the latest changes from GitHub..."
git pull origin $branch

Write-Host "Done. You have the latest version."
Read-Host "Press Enter to close"
