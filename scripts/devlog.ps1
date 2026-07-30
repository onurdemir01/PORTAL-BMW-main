# scripts/devlog.ps1 — Windows sunucuda kullanmak icin PowerShell versiyonu
# PS 5.1 uyumlu (Tee-Object -Encoding parametresi PS7+ gerektirir; burada StreamWriter kullanilir)
# Calistirmak icin:
#   npm run dev:log:win
#   Ya da dogrudan: powershell -ExecutionPolicy Bypass -File scripts\devlog.ps1

$ErrorActionPreference = "Continue"
# Node/npm ciktisi UTF-8 uretir; konsol encoding'i eslestirelim
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

$root      = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$snapDir   = Join-Path $root "logs\$timestamp"
$logAll    = Join-Path $snapDir "all.log"
$logInfo   = Join-Path $snapDir "info.txt"

# Snapshot dizinini olustur
New-Item -ItemType Directory -Path $snapDir -Force | Out-Null

# ── Sistem bilgisi ─────────────────────────────────────────────────────────────
function Get-EnvKeys {
    $envLocalPath = Join-Path $root ".env.local"
    if (-not (Test-Path $envLocalPath)) { return "  .env.local bulunamadi!" }
    (Get-Content $envLocalPath -Encoding UTF8) |
        Where-Object { $_ -notmatch "^\s*#" -and $_ -match "=" } |
        ForEach-Object { "  " + ($_ -split "=")[0].Trim() + " = [SET]" } |
        Sort-Object
}

$nodeVer = try { node --version 2>$null } catch { "N/A" }
$npmVer  = try { npm  --version 2>$null } catch { "N/A" }
$osVer   = [System.Environment]::OSVersion.VersionString
$psVer   = $PSVersionTable.PSVersion.ToString()

$infoLines = @(
    "=== BMW Portal Debug Snapshot ==="
    "Tarih       : $(Get-Date)"
    "Snapshot    : $snapDir"
    ""
    "--- Calisma Ortami ---"
    "Node        : $nodeVer"
    "npm         : $npmVer"
    "OS          : $osVer"
    "PowerShell  : $psVer"
    ""
    "--- .env.local Degisken Anahtarlari (degerler gizli) ---"
) + (Get-EnvKeys) + @(
    ""
    "=== SUNUCU LOGU BASLIYOR: $(Get-Date) ==="
    ""
)

# info.txt UTF-8 (no BOM) yaz
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($logInfo, $infoLines, $utf8NoBom)
[System.IO.File]::WriteAllLines($logAll,  $infoLines, $utf8NoBom)

# Konsola bilgi yaz
Write-Host ""
Write-Host "+----------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|  BMW Portal  - Dev Log                             |" -ForegroundColor Cyan
Write-Host "|  Snapshot : logs\$timestamp\    |" -ForegroundColor Cyan
Write-Host "|  Durdurmak: Ctrl+C                                 |" -ForegroundColor Cyan
Write-Host "+----------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── Cikista ozet yaz ──────────────────────────────────────────────────────────
function Write-Summary {
    $writer = [System.IO.StreamWriter]::new($logAll, $true, $utf8NoBom)
    try {
        $writer.WriteLine("")
        $writer.WriteLine("=== DURDURULDU: $(Get-Date) ===")
        $writer.WriteLine("")
        $writer.WriteLine("--- Snapshot Dosyalari ---")
        Get-ChildItem $snapDir | ForEach-Object {
            $writer.WriteLine("  $($_.Name)  ($([math]::Round($_.Length/1KB,1)) KB)")
        }
    } finally {
        $writer.Flush(); $writer.Close()
    }

    Write-Host ""
    Write-Host "Snapshot kaydedildi: $snapDir" -ForegroundColor Green
    Write-Host "  all.log  : tum cikti"         -ForegroundColor Gray
    Write-Host "  info.txt : ortam bilgisi"      -ForegroundColor Gray
    Write-Host ""
}

# ── npm run dev:all: hem ekrana hem UTF-8 dosyaya yaz ─────────────────────────
# PS 5.1'de Tee-Object -Encoding yok; StreamWriter ile her satiri UTF-8 yaziyoruz.
Set-Location $root

$writer = [System.IO.StreamWriter]::new($logAll, $true, $utf8NoBom)
try {
    npm run dev:all 2>&1 | ForEach-Object {
        $line = [string]$_
        Write-Host $line
        $writer.WriteLine($line)
    }
} finally {
    $writer.Flush()
    $writer.Close()
    Write-Summary
}
