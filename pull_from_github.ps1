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

Write-Host "Fetching from GitHub..."
git fetch origin $branch
if ($LASTEXITCODE -ne 0) { Write-Host "Could not reach GitHub."; exit 1 }

$behind = [int](git rev-list --count "HEAD..origin/$branch")
if ($behind -eq 0) {
    Write-Host "Already up to date. Nothing to pull."
} else {
    Write-Host "$behind new change(s) on GitHub:"
    git log --oneline "HEAD..origin/$branch"
    $before = (git rev-parse HEAD)

    Write-Host "Pulling (your own uncommitted changes are kept)..."
    git pull --rebase --autostash origin $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Pull stopped because of a conflict between your changes and GitHub's."
        Write-Host "Run 'git status' to see the files, fix them, then run 'git rebase --continue'."
        Write-Host "To cancel and go back: git rebase --abort"
        exit 1
    }

    $changed = git diff --name-only $before HEAD
    if ($changed -match "requirements.txt") {
        Write-Host "requirements.txt changed - installing packages..."
        python -m pip install -r requirements.txt
    }
    Write-Host "Pulled the latest code."
}

if (Test-Path ".env") {
    Write-Host "Your .env is set, so data (checkboxes, assessments, settings, Excel files) syncs automatically through the database."
} else {
    Write-Host "Note: no .env file found. Without DATABASE_URL your local data is NOT synced with Render."
}
Write-Host "Restart the app to run the new code."
Read-Host "Press Enter to close"
