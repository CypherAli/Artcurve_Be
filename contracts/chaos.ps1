# ─────────────────────────────────────────────────────────────────────────────
#  ArtCurve — Chaos / Adversarial Test Harness
#
#  MỤC ĐÍCH: chủ động NÉM input độc hại vào contract trên sandbox Anvil để
#  xem hệ thống có tự vệ đúng không. Mỗi kịch bản có kỳ vọng rõ ràng:
#
#    [DEFEND]  input xấu  → contract PHẢI revert. Nếu nó cho qua = LỖ HỔNG.
#    [WORK]    input hợp lệ → contract PHẢI chạy. Nếu revert = hồi quy.
#
#  Kết quả in dạng PASS/FAIL. Một dòng FAIL ở [DEFEND] nghĩa là tìm ra chỗ
#  hệ thống KHÔNG chặn được tấn công — đây chính là giá trị của file này.
#
#  Usage (cần sandbox chạy trước — .\sandbox.ps1):
#    .\chaos.ps1
#
#  KHÔNG chạy trên testnet/mainnet — chỉ trên Anvil (chain 31337).
# ─────────────────────────────────────────────────────────────────────────────
param(
    [int]$Port = 8545
)

$ErrorActionPreference = "Continue"
$RPC = "http://127.0.0.1:$Port"

# Anvil account #0 (deployer, có ETH) và #2 (kẻ tấn công, ví trắng)
$K0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$A0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
$K2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
$A2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
$FACTORY = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"

# ── Đếm kết quả ──────────────────────────────────────────────────────────────
$script:pass = 0
$script:fail = 0
$script:findings = @()

function Section($t) { Write-Host "`n── $t ──" -ForegroundColor Cyan }

# Gửi tx, trả $true nếu THÀNH CÔNG, $false nếu REVERT.
# LƯU Ý: KHÔNG đặt tên param là $Args — đó là biến tự động của PowerShell,
# mảng sẽ không bind và cast bị gọi thiếu tham số (luôn revert). Dùng $CallArgs.
function Send-Tx {
    param([string]$Key, [string]$To, [string]$Sig, [string[]]$CallArgs, [string]$Value = "0")
    $params = @("send", $To, $Sig) + $CallArgs + @("--private-key", $Key, "--rpc-url", $RPC)
    if ($Value -ne "0") { $params += @("--value", $Value) }
    cast @params *> $null
    return ($LASTEXITCODE -eq 0)
}

# Đọc view (trả chuỗi kết quả, "" nếu lỗi)
function Call-View {
    param([string]$To, [string]$Sig, [string[]]$CallArgs = @())
    $params = @("call", $To, $Sig) + $CallArgs + @("--rpc-url", $RPC)
    $out = cast @params 2>$null
    if ($LASTEXITCODE -ne 0) { return "" }
    return $out
}

# Ghi nhận 1 kịch bản. $expectRevert = kỳ vọng input bị chặn.
function Assert-Scenario {
    param([string]$Name, [string]$Kind, [bool]$ExpectRevert, [bool]$Reverted)
    $ok = ($ExpectRevert -eq $Reverted)
    if ($ok) {
        $script:pass++
        Write-Host ("  [PASS] {0,-6} {1}" -f $Kind, $Name) -ForegroundColor Green
    } else {
        $script:fail++
        if ($ExpectRevert) {
            # Input xấu mà KHÔNG bị chặn → lỗ hổng
            Write-Host ("  [FAIL] {0,-6} {1}  ← LỖ HỔNG: input độc hại được chấp nhận!" -f $Kind, $Name) -ForegroundColor Red
            $script:findings += "LỖ HỔNG: $Name — contract không revert input xấu"
        } else {
            Write-Host ("  [FAIL] {0,-6} {1}  ← HỒI QUY: input hợp lệ bị từ chối" -f $Kind, $Name) -ForegroundColor Red
            $script:findings += "HỒI QUY: $Name — contract revert input hợp lệ"
        }
    }
}

# ── 0. Tiền điều kiện ────────────────────────────────────────────────────────
if ((cast chain-id --rpc-url $RPC 2>$null) -ne "31337") {
    Write-Host "[!] Sandbox chưa chạy. Chạy .\sandbox.ps1 trước." -ForegroundColor Red
    exit 1
}
$code = cast code $FACTORY --rpc-url $RPC 2>$null
if (-not $code -or $code.Length -le 4) {
    Write-Host "[!] ArtFactory chưa deploy. Chạy .\sandbox.ps1 trước." -ForegroundColor Red
    exit 1
}
Write-Host "ArtCurve Chaos Harness — target ArtFactory $FACTORY (chain 31337)" -ForegroundColor White

# ══════════════════════════════════════════════════════════════════════════════
#  NHÓM 1 — TẤN CÔNG ArtFactory.createArtwork (input validation)
# ══════════════════════════════════════════════════════════════════════════════
Section "Nhóm 1 — ArtFactory.createArtwork"

# DEFEND: metadataCID rỗng → phải revert ZeroCID
$r = Send-Tx $K0 $FACTORY "createArtwork(string,uint256,uint256)" @("", "1000", "0")
Assert-Scenario "CID rỗng bị chặn" "DEFEND" $true (-not $r)

# DEFEND: targetCap = 50 (< MIN 100) → revert InvalidTargetCap
$r = Send-Tx $K0 $FACTORY "createArtwork(string,uint256,uint256)" @("QmBad", "50", "0")
Assert-Scenario "targetCap dưới ngưỡng bị chặn" "DEFEND" $true (-not $r)

# DEFEND: targetCap = 20 triệu (> MAX 10M) → revert
$r = Send-Tx $K0 $FACTORY "createArtwork(string,uint256,uint256)" @("QmBad", "20000000", "0")
Assert-Scenario "targetCap vượt trần bị chặn" "DEFEND" $true (-not $r)

# DEFEND: creatorFeeRate = 9999 bps (tổng phí > MAX) → revert FeeTooHigh
$r = Send-Tx $K0 $FACTORY "createArtwork(string,uint256,uint256)" @("QmBad", "1000", "9999")
Assert-Scenario "phí quá cao bị chặn" "DEFEND" $true (-not $r)

# WORK: input hợp lệ → tạo được artwork
$r = Send-Tx $K0 $FACTORY "createArtwork(string,uint256,uint256)" @("QmValidArtwork", "1000", "250")
Assert-Scenario "tạo artwork hợp lệ" "WORK" $false (-not $r)

# Lấy địa chỉ AMM clone vừa tạo (artworkId hiện tại)
$amm = ""
$counter = Call-View $FACTORY "getTotalArtworks()(uint256)"
if ($counter) {
    $id = ($counter -split '\s')[0]
    $amm = (Call-View $FACTORY "artworkAMM(uint256)(address)" @($id)) -replace '\s',''
}
if (-not $amm -or $amm -notmatch '^0x[0-9a-fA-F]{40}$') {
    Write-Host "[!] Không lấy được địa chỉ AMM clone — bỏ qua nhóm 2/3." -ForegroundColor Yellow
    Write-Host "    (kiểm tra tên view getTotalArtworks/artworkAMM trong ArtFactory.sol)" -ForegroundColor DarkGray
} else {
    Write-Host "    → AMM clone: $amm" -ForegroundColor DarkGray

    # ══════════════════════════════════════════════════════════════════════════
    #  NHÓM 2 — TẤN CÔNG BondingCurveAMM.buyShares
    # ══════════════════════════════════════════════════════════════════════════
    Section "Nhóm 2 — BondingCurveAMM.buyShares"

    # DEFEND: mua 0 shares → revert ZeroAmount
    $r = Send-Tx $K0 $amm "buyShares(uint256,uint256)" @("0", "1000000000000000000") "1000000000000000000"
    Assert-Scenario "mua 0 share bị chặn" "DEFEND" $true (-not $r)

    # DEFEND: slippage — mua 10 share nhưng gửi 1 wei + maxEthIn=1 → revert SlippageBuy
    $r = Send-Tx $K0 $amm "buyShares(uint256,uint256)" @("10", "1") "1"
    Assert-Scenario "slippage (trả thiếu) bị chặn" "DEFEND" $true (-not $r)

    # DEFEND: mua vượt targetCap (mua 999999 share) → revert ExceedsTargetCap
    $r = Send-Tx $K0 $amm "buyShares(uint256,uint256)" @("999999", "1000000000000000000000000") "1000000000000000000000000"
    Assert-Scenario "mua vượt targetCap bị chặn" "DEFEND" $true (-not $r)

    # DEFEND: deadline hết hạn (deadline=1) → revert TransactionExpired
    $r = Send-Tx $K0 $amm "buySharesWithDeadline(uint256,uint256,uint256)" @("10", "1000000000000000000000", "1") "1000000000000000000000"
    Assert-Scenario "deadline hết hạn bị chặn" "DEFEND" $true (-not $r)

    # WORK: mua hợp lệ — hỏi giá thật rồi trả đúng
    $price = (Call-View $amm "getBuyPrice(uint256)(uint256)" @("10")) -replace '\s.*',''
    if ($price -match '^\d+$') {
        # gửi dư 20% để chắc chắn qua slippage
        $val = [System.Numerics.BigInteger]::Parse($price)
        $val = $val + ($val / 5)
        $r = Send-Tx $K0 $amm "buyShares(uint256,uint256)" @("10", "$val") "$val"
        Assert-Scenario "mua 10 share hợp lệ" "WORK" $false (-not $r)
    } else {
        Write-Host "  [SKIP] WORK  mua hợp lệ (không đọc được getBuyPrice)" -ForegroundColor Yellow
    }

    # ══════════════════════════════════════════════════════════════════════════
    #  NHÓM 3 — TẤN CÔNG BondingCurveAMM.sellShares (ví trắng, account #2)
    # ══════════════════════════════════════════════════════════════════════════
    Section "Nhóm 3 — BondingCurveAMM.sellShares (kẻ tấn công ví trắng)"

    # DEFEND: bán share không sở hữu → revert InsufficientShares
    $r = Send-Tx $K2 $amm "sellShares(uint256,uint256)" @("100", "0")
    Assert-Scenario "bán share không sở hữu bị chặn" "DEFEND" $true (-not $r)

    # DEFEND: bán 0 share → revert ZeroAmount
    $r = Send-Tx $K2 $amm "sellShares(uint256,uint256)" @("0", "0")
    Assert-Scenario "bán 0 share bị chặn" "DEFEND" $true (-not $r)
}

# ── Tổng kết ─────────────────────────────────────────────────────────────────
Write-Host "`n════════════════════ KẾT QUẢ CHAOS ════════════════════" -ForegroundColor White
Write-Host ("  PASS: {0}    FAIL: {1}" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail -eq 0) { "Green" } else { "Red" })
if ($script:findings.Count -gt 0) {
    Write-Host "`n  ⚠ Phát hiện cần xử lý:" -ForegroundColor Red
    $script:findings | ForEach-Object { Write-Host "    • $_" -ForegroundColor Red }
    exit 1
} else {
    Write-Host "  ✓ Hệ thống chặn đúng mọi input độc hại, chấp nhận mọi input hợp lệ." -ForegroundColor Green
    exit 0
}
