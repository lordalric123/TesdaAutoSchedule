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

$commitMessage = Read-Host "Enter commit message"
if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $commitMessage = "update data"
}

Write-Host "Checking status..."
git status --short

Write-Host "Staging all changes..."
git add .

Write-Host "Creating commit..."
git commit -m "$commitMessage"

Write-Host "Pushing to GitHub..."
git push origin $branch

Write-Host "Push complete."
Read-Host "Press Enter to close"
