# ─────────────────────────────────────────────────────────────────────────────
#  ArtCurve — Doctor (chẩn đoán & khắc phục môi trường dev)
#
#  Chạy từ thư mục gốc workspace ("Dự án"). Quét toàn bộ điều kiện cần để
#  chạy dự án local, in CHUẨN ĐOÁN từng mục, và tự SỬA khi có thể.
#
#  Usage:
#    .\doctor.ps1            # chỉ chẩn đoán (không đổi gì)
#    .\doctor.ps1 -Fix       # chẩn đoán + tự khắc phục (tạo .env, npm install,
#                            #   docker up, đồng bộ CHAIN_ID FE/BE...)
#
#  Triết lý: mỗi mục trả OK / WARN / FAIL kèm CÁCH SỬA cụ thể. -Fix chỉ đụng
#  vào thứ an toàn (tạo file từ .example, cài dep, bật service) — không bao giờ
#  ghi đè file đã có hay xóa dữ liệu.
# ─────────────────────────────────────────────────────────────────────────────
param(
    [switch]$Fix
)

$ErrorActionPreference = "Continue"

# Tìm workspace root (thư mục chứa Artcurve_Be + Artcurve_Fe) — script có thể
# nằm trong Artcurve_Be/ hoặc ngay ở root, đi lên tối đa 3 cấp để tìm.
$root = $PSScriptRoot
for ($i = 0; $i -lt 3; $i++) {
    if ((Test-Path (Join-Path $root "Artcurve_Be")) -and (Test-Path (Join-Path $root "Artcurve_Fe"))) { break }
    $parent = Split-Path $root -Parent
    if (-not $parent -or $parent -eq $root) { break }
    $root = $parent
}

$script:ok = 0; $script:warn = 0; $script:fail = 0
$script:todo = @()

function Test-Item {
    param([string]$Name, [ValidateSet("OK","WARN","FAIL")][string]$Status, [string]$Detail = "", [string]$Fix = "")
    $color = @{ OK = "Green"; WARN = "Yellow"; FAIL = "Red" }[$Status]
    $tag   = @{ OK = "[ OK ]"; WARN = "[WARN]"; FAIL = "[FAIL]" }[$Status]
    switch ($Status) { "OK" { $script:ok++ } "WARN" { $script:warn++ } "FAIL" { $script:fail++ } }
    Write-Host ("  {0} {1}" -f $tag, $Name) -ForegroundColor $color
    if ($Detail) { Write-Host "         $Detail" -ForegroundColor DarkGray }
    if ($Fix -and $Status -ne "OK") {
        Write-Host "         → Sửa: $Fix" -ForegroundColor DarkCyan
        $script:todo += $Fix
    }
}

function Have-Cmd($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Port-Busy($p) { [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }

function Section($t) { Write-Host "`n══ $t ══" -ForegroundColor White }

Write-Host "ArtCurve Doctor — chẩn đoán môi trường dev  (root: $root)" -ForegroundColor Cyan
if ($Fix) { Write-Host "Chế độ: -Fix BẬT (sẽ tự khắc phục mục an toàn)" -ForegroundColor Yellow }

# ══ 1. Toolchain ═════════════════════════════════════════════════════════════
Section "1. Toolchain"

if (Have-Cmd node) {
    $nv = (node --version) -replace 'v',''
    $major = [int]($nv -split '\.')[0]
    if ($major -ge 20) { Test-Item "Node.js $nv" "OK" }
    else { Test-Item "Node.js $nv" "WARN" "CI dùng Node 22" "Cài Node 20+ (nvm install 22)" }
} else { Test-Item "Node.js" "FAIL" "không tìm thấy" "Cài Node LTS từ nodejs.org" }

if (Have-Cmd forge) { Test-Item "Foundry (forge/anvil/cast)" "OK" ((forge --version) | Select-Object -First 1) }
else { Test-Item "Foundry" "FAIL" "thiếu forge/anvil/cast" "Cài: https://getfoundry.sh (foundryup)" }

if (Have-Cmd docker) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { Test-Item "Docker" "OK" "daemon đang chạy" }
    else { Test-Item "Docker" "WARN" "cài rồi nhưng daemon chưa bật" "Mở Docker Desktop" }
} else { Test-Item "Docker" "WARN" "không có (cần cho PG/Redis/RabbitMQ local)" "Cài Docker Desktop" }

if (Have-Cmd python) { Test-Item "Python (price-agent)" "OK" (python --version) }
else { Test-Item "Python" "WARN" "cần cho artcurve-price-agent" "Cài Python 3.11+" }

# ══ 2. Repo & dependencies ═══════════════════════════════════════════════════
Section "2. Repo & dependencies"

$nodeRepos = @("Artcurve_Be", "Artcurve_Fe", "artcurve-bo")
foreach ($r in $nodeRepos) {
    $path = Join-Path $root $r
    if (-not (Test-Path $path)) { Test-Item "$r" "WARN" "không thấy thư mục" ""; continue }
    if (Test-Path (Join-Path $path "node_modules")) {
        Test-Item "$r/node_modules" "OK"
    } else {
        $flag = ""
        if ($r -eq "Artcurve_Be") { $flag = " --legacy-peer-deps" }
        Test-Item "$r/node_modules" "FAIL" "chưa cài dep" "cd $r; npm install$flag"
        if ($Fix) {
            Write-Host "         ...đang npm install trong $r" -ForegroundColor DarkGray
            Push-Location $path
            if ($r -eq "Artcurve_Be") { npm install --legacy-peer-deps *> $null } else { npm install *> $null }
            Pop-Location
            if (Test-Path (Join-Path $path "node_modules")) { Write-Host "         ✓ đã cài xong" -ForegroundColor Green }
        }
    }
}

# Foundry libs
$libPath = Join-Path $root "Artcurve_Be\contracts\lib\forge-std"
if (Test-Path $libPath) { Test-Item "contracts/lib (forge-std, OZ)" "OK" }
else { Test-Item "contracts/lib" "FAIL" "thiếu thư viện Solidity" "cd Artcurve_Be\contracts; forge install" }

# ══ 3. File môi trường (.env) ════════════════════════════════════════════════
Section "3. File môi trường"

$envPairs = @(
    @{ Repo = "Artcurve_Be"; Env = ".env";       Example = ".env.example" },
    @{ Repo = "Artcurve_Fe"; Env = ".env.local";  Example = ".env.example" },
    @{ Repo = "artcurve-bo"; Env = ".env";        Example = ".env.example" }
)
foreach ($p in $envPairs) {
    $envFile = Join-Path $root "$($p.Repo)\$($p.Env)"
    $exFile  = Join-Path $root "$($p.Repo)\$($p.Example)"
    if (Test-Path $envFile) {
        Test-Item "$($p.Repo)/$($p.Env)" "OK"
    } elseif (Test-Path $exFile) {
        Test-Item "$($p.Repo)/$($p.Env)" "FAIL" "chưa có" "cp $($p.Example) $($p.Env) rồi điền giá trị"
        if ($Fix) {
            Copy-Item $exFile $envFile
            Write-Host "         ✓ đã tạo từ $($p.Example) — nhớ điền secret" -ForegroundColor Green
        }
    } else {
        Test-Item "$($p.Repo)/$($p.Env)" "WARN" "không có cả .example" ""
    }
}

# ══ 4. Đồng bộ CHAIN_ID giữa FE và BE ════════════════════════════════════════
Section "4. Nhất quán cấu hình chain"

function Get-EnvVal($file, $key) {
    if (-not (Test-Path $file)) { return $null }
    $line = Select-String -Path $file -Pattern "^\s*$key\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line.Line -replace "^\s*$key\s*=\s*", "").Trim()
}
$beEnv = Join-Path $root "Artcurve_Be\.env"
$feEnv = Join-Path $root "Artcurve_Fe\.env.local"
$beChain = Get-EnvVal $beEnv "CHAIN_ID"
$feChain = Get-EnvVal $feEnv "NEXT_PUBLIC_CHAIN_ID"

if ($beChain -and $feChain) {
    if ($beChain -eq $feChain) {
        Test-Item "CHAIN_ID khớp (BE=$beChain, FE=$feChain)" "OK"
    } else {
        Test-Item "CHAIN_ID LỆCH (BE=$beChain, FE=$feChain)" "FAIL" `
            "SIWE login sẽ sai chain, watcher đọc nhầm mạng" `
            "đặt cùng giá trị: 31337 (sandbox) / 84532 (Sepolia) cho cả hai"
    }
} else {
    Test-Item "CHAIN_ID" "WARN" "BE=$beChain FE=$feChain (thiếu 1 bên hoặc chưa có .env)" ""
}

# ══ 5. Sandbox & ports ═══════════════════════════════════════════════════════
Section "5. Sandbox & cổng dịch vụ"

if (Have-Cmd cast) {
    $chainId = cast chain-id --rpc-url http://127.0.0.1:8545 2>$null
    if ($chainId -eq "31337") {
        Test-Item "Anvil sandbox (:8545)" "OK" "chain 31337 đang chạy"
        $factory = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
        $code = cast code $factory --rpc-url http://127.0.0.1:8545 2>$null
        if ($code -and $code.Length -gt 4) { Test-Item "ArtFactory deployed" "OK" $factory }
        else { Test-Item "ArtFactory" "WARN" "Anvil chạy nhưng chưa deploy" "cd Artcurve_Be\contracts; .\sandbox.ps1" }
    } else {
        Test-Item "Anvil sandbox (:8545)" "WARN" "chưa chạy (chỉ cần khi test local chain)" "cd Artcurve_Be\contracts; .\sandbox.ps1"
    }
}

$ports = @(
    @{ P = 3000; Svc = "Frontend (Next)" },
    @{ P = 3001; Svc = "Backend (NestJS)" },
    @{ P = 5432; Svc = "PostgreSQL" },
    @{ P = 6379; Svc = "Redis" },
    @{ P = 5672; Svc = "RabbitMQ" }
)
foreach ($e in $ports) {
    if (Port-Busy $e.P) { Test-Item "$($e.Svc) (:$($e.P))" "OK" "đang lắng nghe" }
    else { Test-Item "$($e.Svc) (:$($e.P))" "WARN" "chưa chạy" "" }
}

# ══ Tổng kết ═════════════════════════════════════════════════════════════════
Write-Host "`n════════════════════ KẾT QUẢ DOCTOR ════════════════════" -ForegroundColor White
Write-Host ("  OK: {0}   WARN: {1}   FAIL: {2}" -f $script:ok, $script:warn, $script:fail) `
    -ForegroundColor $(if ($script:fail -eq 0) { "Green" } else { "Red" })

if ($script:todo.Count -gt 0 -and -not $Fix) {
    Write-Host "`n  Việc cần làm (chạy lại với -Fix để tự khắc phục mục an toàn):" -ForegroundColor Yellow
    $script:todo | Select-Object -Unique | ForEach-Object { Write-Host "    • $_" -ForegroundColor Gray }
}
if ($script:fail -eq 0 -and $script:warn -eq 0) {
    Write-Host "  ✓ Môi trường sẵn sàng chạy full-stack." -ForegroundColor Green
}
exit $(if ($script:fail -gt 0) { 1 } else { 0 })
