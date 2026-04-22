# 在 Windows PowerShell 中执行：从 ECS 拉回代码包 + 环境变量副本（与 scp-env-to-server.ps1 方向相反）
# 使用前请先在服务器执行:  bash /root/sale-system/scripts/pack-for-local-sync.sh

param(
  [string]$Server = "root@114.55.227.24",
  [string]$ParentDir = "J:\sale"
)

$RemoteTgz = "/tmp/sale-system-latest-sync.tgz"
$RemoteEnvProd = "/root/sale-system/.env.production"
$RemoteEnvLocal = "/root/sale-system/.env.local"
$LocalTgz = Join-Path $env:TEMP "sale-system-latest-sync.tgz"
$TargetDir = Join-Path $ParentDir "sale-system"

if (-not (Test-Path -LiteralPath $ParentDir)) {
  Write-Error "请先创建或修改 `$ParentDir: $ParentDir（解压后应得到 $TargetDir）"
  exit 1
}

Write-Host ">> 下载压缩包..."
scp "${Server}:$RemoteTgz" $LocalTgz
if ($LASTEXITCODE -ne 0) {
  Write-Error "拉取失败。请 SSH 登录服务器后先执行: bash /root/sale-system/scripts/pack-for-local-sync.sh"
  exit 1
}

Write-Host ">> 下载环境变量副本（带 .from-cloud 后缀，避免覆盖你本机已有配置）..."
scp "${Server}:$RemoteEnvProd" (Join-Path $ParentDir ".env.production.from-cloud") 2>$null
scp "${Server}:$RemoteEnvLocal" (Join-Path $ParentDir ".env.local.from-cloud") 2>$null

Write-Host ">> 解压到 $ParentDir （会覆盖同名文件，请先自行备份本地 sale-system）"
Push-Location $ParentDir
try {
  tar -xzf $LocalTgz
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "完成。请将需要的变量合并进本机 .env.local，然后在本机目录执行: npm install && npm run dev"
Write-Host "云上的 .env 副本: $ParentDir\.env.production.from-cloud 与 .env.local.from-cloud"
