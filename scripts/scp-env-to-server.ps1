# 在 Windows PowerShell 中执行：把本机环境文件上传到 ECS（含 TENCENT_SECRET_KEY 等）
# 若路径不同，改参数即可，例如：
#   .\scripts\scp-env-to-server.ps1 -LocalEnv "D:\work\sale-system\.env.production"

param(
    [string] $LocalEnv = "J:\sale\sale-system\.env.local",
    [string] $RemoteHost = "root@114.55.227.24",
    [string] $RemotePath = "/root/sale-system/.env.local"
)

$Remote = "${RemoteHost}:${RemotePath}"

if (-not (Test-Path -LiteralPath $LocalEnv)) {
    Write-Error "找不到文件: $LocalEnv"
    exit 1
}

scp $LocalEnv $Remote
if ($LASTEXITCODE -eq 0) {
    Write-Host "上传完成。请在服务器执行:"
    Write-Host "  chmod 600 $RemotePath"
    Write-Host "  cd /root/sale-system && pm2 restart opti-ai --update-env"
}
