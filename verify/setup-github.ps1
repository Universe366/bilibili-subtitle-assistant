# 一键创建 GitHub 私有仓库并推送
#
# 为什么需要你亲自跑：创建仓库、推送都需要**你的** GitHub 凭据。
# 这个脚本会在需要时弹出 GitHub 登录（浏览器或粘贴 token），
# 凭据由 gh / git 自己保管，不会经过我。
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File verify\setup-github.ps1 -RepoName bilibili-subtitle-assistant
#   加 -Public 则建公开仓库

param(
  [Parameter(Mandatory = $true)][string]$RepoName,
  [switch]$Public
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Info($m) { Write-Host ('  ' + $m) }
function Ok($m)   { Write-Host ('  [OK] ' + $m) -ForegroundColor Green }
function Warn($m) { Write-Host ('  [!!] ' + $m) -ForegroundColor Yellow }
function Fail($m) { Write-Host ('  [XX] ' + $m) -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '=== 1/5 check repository state ===' -ForegroundColor Cyan
if (-not (Test-Path '.git')) { Fail 'not a git repository (run from repo root)' }
$dirty = (git status --porcelain | Measure-Object).Count
if ($dirty -gt 0) { Warn ('there are ' + $dirty + ' uncommitted changes') } else { Ok 'working tree clean' }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Ok ('current branch: ' + $branch)

Write-Host ''
Write-Host '=== 2/5 check git identity ===' -ForegroundColor Cyan
$un = git config user.name
$ue = git config user.email
if (-not $un -or -not $ue) { Fail 'git user.name / user.email not configured' }
Ok ($un + ' <' + $ue + '>')

Write-Host ''
Write-Host '=== 3/5 secret guard (last check before push) ===' -ForegroundColor Cyan
$patterns = @(
  'sk-[a-zA-Z0-9]{30,}',
  'ghp_[a-zA-Z0-9]{20,}',
  'cli_[a-z0-9]{20,}',
  'app_secret'
)
$hits = 0
foreach ($pat in $patterns) {
  $found = git grep -I -n -E $pat -- . 2>$null | Where-Object {
    # 排除：占位符、环境变量、文档里提到这个词本身
    $_ -notmatch 'sk-test|sk-mine|sk-abcdefghijklmnop|process\.env|YOUR_|placeholder|apiKey|\.md:'
  }
  if ($found) {
    Warn ('suspicious pattern found: ' + $pat)
    $found | Select-Object -First 5 | ForEach-Object { Write-Host ('      ' + $_) -ForegroundColor Yellow }
    $hits = $hits + 1
  }
}
if ($hits -eq 0) { Ok 'no obvious secrets found' } else { Warn 'please confirm the lines above are not real secrets' }
Info 'repo size is about 32MB (vendor/ffmpeg takes 30.7MB)'

Write-Host ''
Write-Host '=== 4/5 prepare GitHub CLI ===' -ForegroundColor Cyan
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Warn 'GitHub CLI (gh) is not installed.'
  Info 'install it with:  winget install --id GitHub.cli'
  Info ''
  Info 'OR do it manually (no gh needed):'
  Info '  1) create an EMPTY private repo on github.com'
  Info '  2) then run these two commands:'
  Write-Host ''
  Write-Host ('    git remote add origin https://github.com/YOUR_NAME/' + $RepoName + '.git') -ForegroundColor White
  Write-Host ('    git push -u origin ' + $branch) -ForegroundColor White
  Write-Host ''
  exit 1
}
Ok ('gh found: ' + $gh.Source)

$authOk = $false
try {
  gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $authOk = $true }
} catch {
  $authOk = $false
}
if (-not $authOk) {
  Warn 'gh is not logged in. A browser window will open for authorization.'
  gh auth login --web --git-protocol https --scopes repo
  if ($LASTEXITCODE -ne 0) { Fail 'gh login failed' }
}
Ok 'gh is logged in'

Write-Host ''
$visText = if ($Public) { 'PUBLIC' } else { 'PRIVATE' }
Write-Host ('=== 5/5 create ' + $visText + ' repo and push ===') -ForegroundColor Cyan
$visibility = if ($Public) { '--public' } else { '--private' }

$exists = $false
try {
  gh repo view $RepoName 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $exists = $true }
} catch {
  $exists = $false
}

if ($exists) {
  Warn ('repository ' + $RepoName + ' already exists, skipping create')
  $remoteUrl = git remote get-url origin 2>$null
  if (-not $remoteUrl) {
    $user = (gh api user --jq .login).Trim()
    git remote add origin ('https://github.com/' + $user + '/' + $RepoName + '.git')
    Ok ('remote added: https://github.com/' + $user + '/' + $RepoName + '.git')
  }
  git push -u origin $branch
} else {
  gh repo create $RepoName $visibility --source=. --remote=origin --push
}

if ($LASTEXITCODE -ne 0) { Fail 'push failed' }

$url = (gh repo view $RepoName --json url --jq .url).Trim()
Write-Host ''
Write-Host '=== done ===' -ForegroundColor Green
Ok ('repository: ' + $url)
Write-Host ''
Write-Host '  next time you change code:' -ForegroundColor Cyan
Write-Host '    git add -A' -ForegroundColor White
Write-Host '    git commit -m "your message"' -ForegroundColor White
Write-Host '    git push' -ForegroundColor White
Write-Host ''
