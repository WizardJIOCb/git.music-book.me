param(
  [string]$Branch = "main",
  [string]$HostName = "root@82.146.42.213",
  [string]$AppDir = "/var/www/gpt.music-book.me",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

Write-Host "[deploy-prod] branch: $Branch"
Write-Host "[deploy-prod] host: $HostName"
Write-Host "[deploy-prod] app dir: $AppDir"

if (-not $SkipPush) {
  git push origin $Branch
}

ssh $HostName "cd $AppDir && bash deploy.sh $Branch"

Write-Host "[deploy-prod] done"
