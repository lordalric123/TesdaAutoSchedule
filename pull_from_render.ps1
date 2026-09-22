param(
    [string]$RenderUrl = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataRoot = Join-Path $repoRoot "data"
$excelRoot = Join-Path $dataRoot "excel"

if (-not $RenderUrl) {
    $RenderUrl = Read-Host "Paste your Render app URL (example: https://tesda-scheduler.onrender.com)"
}

$RenderUrl = $RenderUrl.Trim().TrimEnd('/')
$zipPath = Join-Path $env:TEMP "tesda_render_backup.zip"
$tempDir = Join-Path $env:TEMP ("tesda_render_restore_" + [System.Guid]::NewGuid().ToString('N'))

try {
    if ($RenderUrl -match '^file://') {
        $zipPath = ([System.Uri]$RenderUrl).LocalPath
    }
    elseif ($RenderUrl -match '\.zip$') {
        $zipPath = $RenderUrl
    }
    else {
        $downloadUrl = "$RenderUrl/api/backup/export"
        Write-Host "Downloading backup from $downloadUrl"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    }

    if (-not (Test-Path $zipPath)) {
        throw "Backup file was not found: $zipPath"
    }

    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

    $required = @('assessments.json', 'representatives.json', 'settings.json', 'task_status.json')
    foreach ($name in $required) {
        $source = Join-Path $tempDir $name
        if (-not (Test-Path $source)) {
            throw "Missing file in backup: $name"
        }
    }

    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $excelRoot | Out-Null

    Copy-Item (Join-Path $tempDir 'assessments.json') (Join-Path $dataRoot 'assessments.json') -Force
    Copy-Item (Join-Path $tempDir 'representatives.json') (Join-Path $dataRoot 'representatives.json') -Force
    Copy-Item (Join-Path $tempDir 'settings.json') (Join-Path $dataRoot 'settings.json') -Force
    Copy-Item (Join-Path $tempDir 'task_status.json') (Join-Path $dataRoot 'task_status.json') -Force

    $excelSource = Join-Path $tempDir 'excel'
    if (Test-Path $excelSource) {
        Copy-Item (Join-Path $excelSource '*') $excelRoot -Recurse -Force
    }

    Write-Host "Restore complete. Data was copied into $dataRoot"
    Write-Host "Starting local app..."
    & (Join-Path $repoRoot 'run.bat')
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
}
