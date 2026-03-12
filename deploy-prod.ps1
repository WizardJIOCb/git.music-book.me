param(
  [string]$Branch = "main",
  [string]$HostName = "root@82.146.42.213",
  [string]$AppDir = "/var/www/gpt.music-book.me",
  [string]$CommitMessage = "",
  [switch]$SkipCommit,
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

Write-Host "[deploy-prod] branch: $Branch"
Write-Host "[deploy-prod] host: $HostName"
Write-Host "[deploy-prod] app dir: $AppDir"

$status = git status --porcelain
$hasChanges = -not [string]::IsNullOrWhiteSpace(($status -join "`n"))

if ($hasChanges) {
  Write-Host "[deploy-prod] detected local changes"
  $status | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "[deploy-prod] no local changes detected"
}

if ($hasChanges -and -not $SkipCommit) {
  if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $CommitMessage = "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  }

  git add -A
  git commit -m $CommitMessage
}

if (-not $SkipPush) {
  git push origin $Branch
}

ssh $HostName "cd $AppDir && bash deploy.sh $Branch"

Write-Host "[deploy-prod] done"
