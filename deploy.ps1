# CPA Console 一键发布脚本：构建前端 -> 停旧实例 -> 编译 -> 重启 -> 健康检查 ->（可选）提交
# 用法：
#   .\deploy.ps1                      # 全量：前端 + 后端，重建重启
#   .\deploy.ps1 -SkipFrontend        # 只改了 Go 代码：跳过前端构建
#   .\deploy.ps1 -Message "提交说明"   # 构建并重启成功后自动 git add -A + commit
param(
    [switch]$SkipFrontend,
    [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$port = 8790

# 1. 构建前端（dist 会被嵌入二进制，必须先于 go build）
if (-not $SkipFrontend) {
    Write-Host '[1/4] 构建前端...' -ForegroundColor Cyan
    Push-Location frontend
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw '前端构建失败' }
    Pop-Location
} else {
    Write-Host '[1/4] 跳过前端构建' -ForegroundColor DarkGray
}

# 2. 停止旧实例（Windows 下运行中的 exe 无法覆盖，必须先停）
Write-Host '[2/4] 停止旧实例...' -ForegroundColor Cyan
Get-Process cpa-console, cpa-console-dev, air -ErrorAction SilentlyContinue | Stop-Process -Force

# 3. 编译后端
Write-Host '[3/4] 编译后端...' -ForegroundColor Cyan
go build -o cpa-console.exe ./cmd/cpa-console
if ($LASTEXITCODE -ne 0) { throw 'Go 编译失败' }

# 4. 启动并健康检查
Write-Host '[4/4] 启动服务...' -ForegroundColor Cyan
Start-Process -FilePath (Join-Path $root 'cpa-console.exe') -WorkingDirectory $root -WindowStyle Hidden

$ok = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $resp = Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
}

if ($ok) {
    Write-Host "完成：http://localhost:$port 已就绪" -ForegroundColor Green
} else {
    Write-Host '警告：服务未在 5 秒内就绪，请检查端口占用或运行日志' -ForegroundColor Yellow
}

# 提交（仅在显式传入 -Message 时执行，避免误提交）
if ($Message) {
    Write-Host "提交版本：$Message" -ForegroundColor Cyan
    git add -A
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw 'git 提交失败' }
    git log --oneline -1
}
