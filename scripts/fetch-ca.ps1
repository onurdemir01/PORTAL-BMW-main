# scripts/fetch-ca.ps1 — Bir HTTPS hedefinin sundugu TLS sertifika zincirini yakalar.
# Windows PowerShell 5.1 UYUMLU (pwsh gerekmez).
#
# KULLANIM (kurumsal agda):
#   powershell -ExecutionPolicy Bypass -File .\scripts\fetch-ca.ps1 -TargetHost api.openai.com
#   powershell -ExecutionPolicy Bypass -File .\scripts\fetch-ca.ps1 -TargetHost dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr -OutDir server\certs\mcp
#
# CIKTILAR (OutDir altinda):
#   certificate-0.pem/.cer  → leaf (sunucu sertifikasi)
#   certificate-N.pem/.cer  → intermediate/root CA'lar
#   <host>-ca-chain.pem     → leaf HARIC tum CA zinciri (CORP_CA_CERT_PATH icin)
#
# Sonraki adimlar: node scripts/build-ca-bundle.cjs  →  node scripts/test-tls.cjs
# Tam rehber: docs/TLS-SETUP.md
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetHost,

    [int]$Port = 443,

    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

if ($OutDir -eq "") {
    $safeName = $TargetHost -replace "[^a-zA-Z0-9.-]", "_"
    $OutDir = Join-Path "server\certs" $safeName
}

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

Write-Host "── Hedef: ${TargetHost}:${Port}"
Write-Host "── Cikti dizini: $OutDir"

# Zincir yakalama: RemoteCertificateValidationCallback icinde chain elemanlarini topla.
# PS 5.1 tuzaklari: generic List cok satirli tanimlanamaz, method parametresi icinde
# New-Object sorun cikarir → ArrayList + onceden tanimli callback kullanilir.
$capturedCerts = New-Object System.Collections.ArrayList

$callback = {
    param($senderObj, $certificate, $chain, $sslPolicyErrors)
    Write-Host "TLS policy result: $sslPolicyErrors"
    if ($chain -ne $null) {
        foreach ($element in $chain.ChainElements) {
            $null = $capturedCerts.Add($element.Certificate)
        }
    }
    # Yakalama amacli her zaman kabul et (yalnizca bu baglanti icin; sisteme etkisi yok)
    return $true
}

$tcpClient = New-Object System.Net.Sockets.TcpClient
$tcpClient.Connect($TargetHost, $Port)

$sslStream = New-Object System.Net.Security.SslStream($tcpClient.GetStream(), $false, $callback)
try {
    $sslStream.AuthenticateAsClient($TargetHost)
    Write-Host "TLS handshake completed"
}
finally {
    $sslStream.Dispose()
    $tcpClient.Close()
}

if ($capturedCerts.Count -eq 0) {
    Write-Error "Sertifika yakalanamadı."
    exit 1
}

Write-Host ""
Write-Host "── Yakalanan zincir ($($capturedCerts.Count) sertifika):"

$chainPemLines = New-Object System.Collections.ArrayList
$index = 0

foreach ($cert in $capturedCerts) {
    Write-Host ""
    Write-Host "[$index] Subject: $($cert.Subject)"
    Write-Host "    Issuer : $($cert.Issuer)"
    Write-Host "    ValidTo: $($cert.NotAfter)"

    $der = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $b64 = [System.Convert]::ToBase64String($der, [System.Base64FormattingOptions]::InsertLineBreaks)
    $pem = "-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----"

    $cerPath = Join-Path $OutDir "certificate-$index.cer"
    $pemPath = Join-Path $OutDir "certificate-$index.pem"
    [System.IO.File]::WriteAllBytes($cerPath, $der)
    [System.IO.File]::WriteAllText($pemPath, $pem)

    # index 0 = leaf → CA zincirine girmez; geri kalan her sey zincire eklenir
    if ($index -gt 0) {
        $null = $chainPemLines.Add("# [$index] $($cert.Subject)")
        $null = $chainPemLines.Add($pem)
    }
    $index++
}

$hostFile = ($TargetHost -replace "[^a-zA-Z0-9.-]", "_") + "-ca-chain.pem"
$chainPath = Join-Path $OutDir $hostFile

if ($chainPemLines.Count -gt 0) {
    [System.IO.File]::WriteAllText($chainPath, ($chainPemLines -join "`r`n"))
    Write-Host ""
    Write-Host "✓ CA zinciri yazildi: $chainPath"
}
else {
    Write-Warning "Zincirde leaf dışında sertifika yok — sunucu intermediate göndermiyor olabilir."
    Write-Warning "Kurumsal kök CA'yı IT/sertifika portalından alıp elle ekleyin."
}

Write-Host ""
Write-Host "Sonraki adimlar:"
Write-Host "  1) node scripts/build-ca-bundle.cjs      # tum zincirleri public koklerle birlestir"
Write-Host "  2) node scripts/test-tls.cjs             # hedefleri dogrula"
Write-Host "  3) .env.local: CORP_CA_CERT_PATH=server/certs/combined-ca-chain.pem"
