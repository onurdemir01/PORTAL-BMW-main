# BMW Portal - Setup & Diagnostic Script
# Kullanim: powershell -ExecutionPolicy Bypass -File setup.ps1 [-TestConnectivity] [-InstallDeps] [-All]

param(
    [switch]$TestConnectivity,
    [switch]$InstallDeps,
    [switch]$All
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# PowerShell 5.x icin SSL sertifika dogrulamasini devre disi birak (kurumsal self-signed sertifikalar)
$psVer = $PSVersionTable.PSVersion.Major
if ($psVer -lt 7) {
    try {
        Add-Type -TypeDefinition @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@ -ErrorAction SilentlyContinue
        [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    } catch { }
}

function Invoke-WebSafe {
    param([string]$Uri, [hashtable]$Headers = @{}, [int]$TimeoutSec = 10)
    if ($psVer -ge 7) {
        return Invoke-RestMethod -Uri $Uri -Headers $Headers -SkipCertificateCheck -TimeoutSec $TimeoutSec -ErrorAction Stop
    } else {
        return Invoke-RestMethod -Uri $Uri -Headers $Headers -TimeoutSec $TimeoutSec -ErrorAction Stop
    }
}

function Invoke-WebRequestSafe {
    param([string]$Uri, [int]$TimeoutSec = 5)
    if ($psVer -ge 7) {
        return Invoke-WebRequest -Uri $Uri -SkipCertificateCheck -TimeoutSec $TimeoutSec -ErrorAction Stop
    } else {
        return Invoke-WebRequest -Uri $Uri -TimeoutSec $TimeoutSec -ErrorAction Stop
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BMW Portal - Setup ve Tani" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Node.js versiyonu ----------
Write-Host "[1/6] Node.js versiyonu kontrol ediliyor..." -ForegroundColor Yellow
try {
    $nodeRaw = & node --version 2>&1
    $npmRaw  = & npm  --version 2>&1
    Write-Host "  Node.js : $nodeRaw" -ForegroundColor Green
    Write-Host "  npm     : $npmRaw"  -ForegroundColor Green
    $major = [int]([string]$nodeRaw -replace 'v(\d+).*', '$1')
    if ($major -lt 18) {
        Write-Host "  UYARI: Node.js 18+ gerekli! Mevcut: $nodeRaw" -ForegroundColor Red
    }
} catch {
    Write-Host "  HATA: Node.js bulunamadi. https://nodejs.org adresinden yukleyin." -ForegroundColor Red
}

# ---------- 2. .env.local kontrol ----------
Write-Host ""
Write-Host "[2/6] Ortam degiskenleri kontrol ediliyor..." -ForegroundColor Yellow
$envFile = Join-Path $ScriptDir ".env.local"
$envExample = Join-Path $ScriptDir ".env.example"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "  .env.local .env.example'den olusturuldu. Degerleri doldurun!" -ForegroundColor Yellow
    } else {
        Write-Host "  UYARI: .env.local bulunamadi ve .env.example de yok!" -ForegroundColor Red
        Write-Host "  Manuel olusturun: Copy-Item .env.example .env.local" -ForegroundColor DarkYellow
    }
}

if (Test-Path $envFile) {
    Write-Host "  .env.local bulundu." -ForegroundColor Green
    $envContent = Get-Content $envFile -Raw -Encoding UTF8

    $checks = @(
        [PSCustomObject]@{ Key = "MSSQL_SERVER";          Desc = "MSSQL sunucu adresi" },
        [PSCustomObject]@{ Key = "MSSQL_PASSWORD";        Desc = "MSSQL sifresi" },
        [PSCustomObject]@{ Key = "LDAP_URL";              Desc = "LDAP URL" },
        [PSCustomObject]@{ Key = "LDAP_BIND_PASSWORD";    Desc = "LDAP servis hesabi sifresi" },
        [PSCustomObject]@{ Key = "SESSION_SECRET";        Desc = "Session secret" },
        [PSCustomObject]@{ Key = "NOBETCI_TEAM_ID";       Desc = "Nobet takim ID (opsiyonel)" },
        [PSCustomObject]@{ Key = "LOGX_DEFAULT_USERNAME"; Desc = "LogX 1111 kullanici (opsiyonel)" },
        [PSCustomObject]@{ Key = "LOGX_DEFAULT_PASSWORD"; Desc = "LogX 1111 sifresi (opsiyonel)" },
        [PSCustomObject]@{ Key = "AI_PROVIDER";           Desc = "AI provider (anthropic/openai)" },
        [PSCustomObject]@{ Key = "ANTHROPIC_API_KEY";     Desc = "Anthropic API key" },
        [PSCustomObject]@{ Key = "AWX_URL";               Desc = "AWX URL (opsiyonel)" }
    )

    foreach ($c in $checks) {
        # Satir basi # ile baslamayan (yorum degil), KEY=deger formatindaki satirlari eslestir
        $pattern = "(?m)^(?!#)$([regex]::Escape($c.Key))=(.+)$"
        if ($envContent -match $pattern) {
            $val = $Matches[1].Trim()
            # Deger bos veya sadece bosluksa ya da # ile basliyorsa tanimlanmamis say
            if ($val -eq "" -or $val -match "^#") {
                Write-Host ("  [ ] {0,-30} - {1}" -f $c.Key, $c.Desc) -ForegroundColor DarkYellow
            } else {
                Write-Host ("  [x] {0,-30} - ayarli" -f $c.Key) -ForegroundColor Green
            }
        } else {
            Write-Host ("  [ ] {0,-30} - {1}" -f $c.Key, $c.Desc) -ForegroundColor DarkYellow
        }
    }
} else {
    Write-Host "  .env.local bulunamadi, kontrol atlaniyor." -ForegroundColor DarkYellow
}

# ---------- 3. npm bagimliliklar ----------
Write-Host ""
Write-Host "[3/6] npm bagimliliklar kontrol ediliyor..." -ForegroundColor Yellow
$nmPath = Join-Path $ScriptDir "node_modules"
if (Test-Path $nmPath) {
    Write-Host "  node_modules mevcut." -ForegroundColor Green
} else {
    Write-Host "  node_modules yok!" -ForegroundColor Yellow
    if ($InstallDeps -or $All) {
        Push-Location $ScriptDir
        & npm install
        Pop-Location
    } else {
        Write-Host "  Yuklemek icin: npm install  veya  .\setup.ps1 -InstallDeps" -ForegroundColor DarkYellow
    }
}

# ---------- 4. Ag baglanti testleri ----------
Write-Host ""
Write-Host "[4/6] Ag baglanti testleri..." -ForegroundColor Yellow

$targets = @(
    [PSCustomObject]@{ Host = "gbnys.fw.garanti.com.tr"; Port = 443;  Desc = "Nobet API (HTTPS)" },
    [PSCustomObject]@{ Host = "adds.fw.garanti.com.tr";  Port = 636;  Desc = "LDAP / LDAPS" },
    [PSCustomObject]@{ Host = "10.230.111.44";           Port = 1453; Desc = "MSSQL Inventory" }
)

if (Test-Path $envFile) {
    $awxLine = (Get-Content $envFile) | Where-Object { $_ -match "^AWX_URL=(.+)" }
    if ($awxLine -and $Matches -and $Matches[1].Trim() -ne "") {
        $awxHost = $Matches[1].Trim() -replace "https?://", "" -replace "/.*", ""
        if ($awxHost) {
            $targets += [PSCustomObject]@{ Host = $awxHost; Port = 443; Desc = "AWX / Tower" }
        }
    }
}

foreach ($t in $targets) {
    if ($TestConnectivity -or $All) {
        try {
            $conn = Test-NetConnection -ComputerName $t.Host -Port $t.Port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
            if ($conn.TcpTestSucceeded) {
                Write-Host ("  [OK ] {0}:{1} - {2}" -f $t.Host, $t.Port, $t.Desc) -ForegroundColor Green
            } else {
                Write-Host ("  [NOK] {0}:{1} - {2} (ERISILEMEZ)" -f $t.Host, $t.Port, $t.Desc) -ForegroundColor Red
            }
        } catch {
            Write-Host ("  [ERR] {0}:{1} - {2}" -f $t.Host, $t.Port, $_.Exception.Message) -ForegroundColor Red
        }
    } else {
        Write-Host ("  {0}:{1} - {2}" -f $t.Host, $t.Port, $t.Desc) -ForegroundColor Gray
    }
}
if (-not ($TestConnectivity -or $All)) {
    Write-Host "  Baglanti testi icin: .\setup.ps1 -TestConnectivity" -ForegroundColor DarkYellow
}

# ---------- 5. LogX 1111 hizli test ----------
Write-Host ""
Write-Host "[5/6] LogX 1111 portu hizli test..." -ForegroundColor Yellow
$testIp = Read-Host "  Test edilecek sunucu IP'si (Enter = atla)"
if ($testIp.Trim() -ne "") {
    if ($TestConnectivity -or $All) {
        $conn = Test-NetConnection -ComputerName $testIp.Trim() -Port 1111 -WarningAction SilentlyContinue
        if ($conn.TcpTestSucceeded) {
            Write-Host "  [OK ] $($testIp):1111 - Port acik" -ForegroundColor Green
            try {
                $resp = Invoke-WebRequestSafe -Uri "https://$($testIp.Trim()):1111/" -TimeoutSec 5
                Write-Host "  [OK ] HTTPS $($testIp):1111 - HTTP $($resp.StatusCode)" -ForegroundColor Green
            } catch {
                Write-Host "  [?  ] HTTPS test: $($_.Exception.Message)" -ForegroundColor DarkYellow
            }
        } else {
            Write-Host "  [NOK] $($testIp):1111 - Port kapali veya erisilemez" -ForegroundColor Red
        }
    } else {
        Write-Host "  IP girildi ama -TestConnectivity parametresi yok. Ekleyin." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  Atlandi." -ForegroundColor Gray
}

# ---------- 6. Nobet API testi ----------
Write-Host ""
Write-Host "[6/6] Nobet API testi..." -ForegroundColor Yellow

$nobetTeamId = ""
if (Test-Path $envFile) {
    $tidLine = (Get-Content $envFile) | Where-Object { $_ -match "^NOBETCI_TEAM_ID=(.+)" }
    if ($tidLine -and $Matches -and $Matches[1].Trim() -ne "") {
        $nobetTeamId = $Matches[1].Trim()
    }
}

if ($TestConnectivity -or $All) {
    try {
        if ($nobetTeamId -ne "") {
            $nobetUri = "https://gbnys.fw.garanti.com.tr/api/nobetkayit/current/$nobetTeamId/AGILE"
            Write-Host "  ID endpoint kullaniliyor: $nobetUri" -ForegroundColor Gray
        } else {
            $nobetUri = "https://gbnys.fw.garanti.com.tr/api/nobetkayit/homepage/currentlist"
        }
        $headers = @{
            "Accept"       = "application/json, text/plain, */*"
            "Content-Type" = "text/plain"
            "Referer"      = "https://gbnys.fw.garanti.com.tr/"
            "User-Agent"   = "BMW-Portal-Diagnostic/1.0"
        }
        $resp = Invoke-WebSafe -Uri $nobetUri -Headers $headers -TimeoutSec 10
        Write-Host "  [OK ] Nobet API yanit verdi." -ForegroundColor Green

        # Ham response'u goster (ilk 300 karakter)
        $rawJson = $resp | ConvertTo-Json -Depth 3 -Compress
        Write-Host "  Ham yanit (ilk 300 kr): $($rawJson.Substring(0, [Math]::Min(300, $rawJson.Length)))" -ForegroundColor Gray

        if ($nobetTeamId -ne "") {
            # asNobetci veya yedekNobetci formatini dene
            if ($resp -is [array] -and $resp.Count -gt 0) {
                $first = $resp[0]
                $sentry = $first.asNobetci.fullName
                if (-not $sentry) { $sentry = $first.mainSentry.fullName }
                if (-not $sentry) { $sentry = $first.yedekNobetci.fullName }
                if ($sentry) {
                    Write-Host "  Bugunku nobetci: $sentry" -ForegroundColor Cyan
                } else {
                    Write-Host "  asNobetci alani bulunamadi. Ham obje: $($first | ConvertTo-Json -Compress)" -ForegroundColor DarkYellow
                }
            }
        } else {
            $team = $resp | Where-Object { $_.team.name -eq "GT-Agile BMW" } | Select-Object -First 1
            if ($team) {
                Write-Host "  Bugunku nobetci (GT-Agile BMW): $($team.mainSentry.fullName)" -ForegroundColor Cyan
            } else {
                Write-Host "  GT-Agile BMW takimi bulunamadi. Mevcut takimlar:" -ForegroundColor DarkYellow
                $resp | ForEach-Object { Write-Host "    - $($_.team.name)" -ForegroundColor Gray }
            }
        }
    } catch {
        Write-Host "  [NOK] Nobet API erisilemedi: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Not: Bu API sadece kurumsal agdan erisebilir." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  Test icin: .\setup.ps1 -TestConnectivity" -ForegroundColor DarkYellow
}

# ---------- Ozet ----------
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tamamlandi!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Portali baslatmak icin : npm run dev:all" -ForegroundColor White
Write-Host "Sadece backend         : npm run server" -ForegroundColor White
Write-Host "TypeScript kontrol     : npx tsc --noEmit" -ForegroundColor White
Write-Host ""
Write-Host "Tam test icin: .\setup.ps1 -All" -ForegroundColor Gray
Write-Host ""
