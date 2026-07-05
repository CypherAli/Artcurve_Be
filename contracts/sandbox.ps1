# ─────────────────────────────────────────────────────────────────────────────
#  ArtCurve — Sandbox local (Anvil)
#
#  MỘT LỆNH dựng blockchain sandbox trên máy: chain riêng (id 31337), contract
#  ArtCurve deploy sẵn, ví có bao nhiêu ETH tùy ý — test thoải mái, tắt đi
#  bật lại là chain sạch như mới.
#
#  Usage:
#    .\sandbox.ps1                                  # dựng chain + deploy contract
#    .\sandbox.ps1 -Wallet 0xVI_METAMASK_CUA_BAN    # + nạp 1000 ETH cho ví bạn
#    .\sandbox.ps1 -Wallet 0x... -Eth 50000         # + nạp số ETH tùy ý
#
#  Yêu cầu: Foundry (forge, anvil, cast) — https://getfoundry.sh
#
#  LƯU Ý KỸ THUẬT (đừng "tối ưu" lại các workaround này):
#    - forge/solc vỡ pipe (os error 232) khi chạy trong đường dẫn có ký tự
#      Unicode ("Dự án") → script mirror contracts sang %TEMP% rồi chạy ở đó.
#    - forge tự đọc contracts/.env (chứa PRIVATE_KEY thật) → mirror LOẠI TRỪ
#      .env; mọi env cần thiết được set tường minh bên dưới bằng key Anvil #0
#      (key công khai, ai cũng biết — KHÔNG BAO GIỜ dùng ngoài local).
#    - --skip test: deploy không cần compile test files.
# ─────────────────────────────────────────────────────────────────────────────
param(
    [string]$Wallet = "",      # ví MetaMask của bạn (optional) — sẽ được nạp ETH
    [string]$Eth    = "1000",  # số ETH nạp cho ví trên
    [int]$Port      = 8545
)

$ErrorActionPreference = "Stop"
$RPC = "http://127.0.0.1:$Port"

# ── Anvil account #0 (deterministic, có sẵn 10.000 ETH) ──────────────────────
$DEPLOYER_KEY  = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$DEPLOYER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
$ADMIN_ADDR    = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  # account #1

# ── 0. Kiểm tra Foundry ──────────────────────────────────────────────────────
foreach ($tool in @("anvil", "forge", "cast")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "[!] Thiếu '$tool' — cài Foundry: https://getfoundry.sh" -ForegroundColor Red
        exit 1
    }
}

# ── 1. Bật Anvil (nếu chưa chạy) ─────────────────────────────────────────────
$anvilUp = $false
try {
    $chainId = cast chain-id --rpc-url $RPC 2>$null
    if ($chainId -eq "31337") { $anvilUp = $true }
} catch {}

if ($anvilUp) {
    Write-Host "[i] Anvil đã chạy sẵn trên port $Port (chain 31337) — dùng luôn." -ForegroundColor Yellow
} else {
    Write-Host "[1/4] Bật Anvil (chain-id 31337, port $Port)..." -ForegroundColor Cyan
    Start-Process anvil -ArgumentList "--chain-id 31337 --port $Port" -WindowStyle Minimized
    $ready = $false
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 1
        try {
            if ((cast chain-id --rpc-url $RPC 2>$null) -eq "31337") { $ready = $true; break }
        } catch {}
    }
    if (-not $ready) { Write-Host "[!] Anvil không phản hồi sau 30s" -ForegroundColor Red; exit 1 }
    Write-Host "      Anvil sẵn sàng ✓" -ForegroundColor Green
}

# Địa chỉ deterministic (chain sạch + key cố định → lần nào cũng y hệt)
$TOKEN_IMPL = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
$AMM_IMPL   = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
$FACTORY    = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"

# ── Đã deploy rồi thì bỏ qua (deploy lại trên chain cũ sẽ lệch địa chỉ) ──────
$alreadyDeployed = $false
try {
    $existing = cast code $FACTORY --rpc-url $RPC 2>$null
    if ($existing -and $existing.Length -gt 4) { $alreadyDeployed = $true }
} catch {}

if ($alreadyDeployed) {
    Write-Host "[2-3/4] ArtFactory đã có trên chain — bỏ qua deploy. (Muốn chain sạch: tắt Anvil rồi chạy lại)" -ForegroundColor Yellow
} else {

# ── 2. Mirror contracts sang %TEMP% (né lỗi Unicode path + .env thật) ────────
Write-Host "[2/4] Mirror contracts sang thư mục tạm (né lỗi solc với đường dẫn có dấu)..." -ForegroundColor Cyan
$work = Join-Path $env:TEMP "artcurve-sandbox\contracts"
robocopy $PSScriptRoot $work /MIR /XF .env deploy-full.log /XD broadcast cache out .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host "[!] Robocopy lỗi ($LASTEXITCODE)" -ForegroundColor Red; exit 1 }

# ── 3. Deploy ArtCurve lên Anvil ─────────────────────────────────────────────
Write-Host "[3/4] Deploy contracts (ArtFractionToken + BondingCurveAMM + ArtFactory)..." -ForegroundColor Cyan
Push-Location $work
$env:PRIVATE_KEY               = $DEPLOYER_KEY
$env:ADMIN_ADDRESS             = $ADMIN_ADDR
$env:PLATFORM_TREASURY_ADDRESS = $ADMIN_ADDR
$env:PLATFORM_FEE_BPS          = "100"   # 1%
$env:DEFAULT_CREATOR_FEE_BPS   = "250"   # 2.5%
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --skip test *> sandbox-deploy.log
$deployExit = $LASTEXITCODE
Pop-Location
if ($deployExit -ne 0) {
    Write-Host "[!] Deploy lỗi — xem log: $work\sandbox-deploy.log" -ForegroundColor Red
    Get-Content "$work\sandbox-deploy.log" -Tail 10
    exit 1
}

}

# Xác minh on-chain thật sự (không tin log suông)
$code = cast code $FACTORY --rpc-url $RPC
if ($code.Length -le 4) { Write-Host "[!] ArtFactory không có bytecode — deploy thất bại" -ForegroundColor Red; exit 1 }
Write-Host "      ArtFactory on-chain ✓ ($([math]::Floor($code.Length/2)) bytes)" -ForegroundColor Green

# ── 4. Nạp ETH cho ví của bạn (nếu có) ──────────────────────────────────────
if ($Wallet) {
    Write-Host "[4/4] Nạp $Eth ETH cho $Wallet..." -ForegroundColor Cyan
    $wei = cast to-wei $Eth ether
    $hex = cast to-hex $wei
    cast rpc anvil_setBalance $Wallet $hex --rpc-url $RPC | Out-Null
    $bal = cast balance $Wallet --rpc-url $RPC --ether
    Write-Host "      Số dư mới: $bal ETH ✓" -ForegroundColor Green
} else {
    Write-Host "[4/4] (Bỏ qua nạp ví — thêm -Wallet 0x... để nạp ETH cho ví MetaMask của bạn)" -ForegroundColor DarkGray
}

# ── Tổng kết ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════ SANDBOX SẴN SÀNG ════════════════" -ForegroundColor Green
Write-Host "  RPC              : $RPC   (chain-id 31337)"
Write-Host "  ArtFactory       : $FACTORY"
Write-Host "  AMM impl         : $AMM_IMPL"
Write-Host "  Token impl       : $TOKEN_IMPL"
Write-Host "  Deployer (#0)    : $DEPLOYER_ADDR  (key Anvil công khai)"
Write-Host ""
Write-Host "  ▶ MetaMask: Add network → RPC $RPC, Chain ID 31337, Currency ETH" -ForegroundColor Cyan
Write-Host "  ▶ Frontend: trong Artcurve_Fe/.env.local đặt:" -ForegroundColor Cyan
Write-Host "      NEXT_PUBLIC_CHAIN_ID=31337"
Write-Host "  ▶ Backend (nếu chạy full-stack): trong Artcurve_Be/.env đặt:" -ForegroundColor Cyan
Write-Host "      CHAIN_ID=31337"
Write-Host "      RPC_URL=$RPC"
Write-Host "      WS_RPC_URL=ws://127.0.0.1:$Port"
Write-Host "      CONTRACT_ART_FACTORY_SEPOLIA=$FACTORY"
Write-Host ""
Write-Host "  Nạp thêm ETH bất kỳ lúc nào:" -ForegroundColor DarkGray
Write-Host "    cast rpc anvil_setBalance DIA_CHI_VI `$(cast to-hex `$(cast to-wei 5000 ether)) --rpc-url $RPC" -ForegroundColor DarkGray
Write-Host "  Reset chain sạch: tắt cửa sổ Anvil rồi chạy lại script này." -ForegroundColor DarkGray
