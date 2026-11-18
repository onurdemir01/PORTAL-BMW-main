@Library('standart-pipeline')

// Kurumsal Jenkins isi (standart_pipeline). Bu dosya kurumsal is tanimi deposundaki kopyanin KAYNAGIDIR;
// degisiklik once burada yapilir, sonra oraya kopyalanir. KURUMSAL KOPYADA `EKIP_EPOSTA_ADRESI` yerine
// ekip e-posta adresi yazilir; gercek adres public repoya yazilmaz.
// Bekci: server/__tests__/kurumsal-pipeline.test.js. Ayrinti: docs/KALITE-KAPILARI.md "Kurumsal Jenkins".
//
//   - tools yalniz nodejs: kutuphane npm + yalniz nodejs icin Linux ajani (POD&&NODEJS) secer. Arac
//     verilmezse varsayilan ajana duser; derleme araclari orada kurulamaz.
//   - commands YALNIZ install + "run kurumsal:derle" (degismez sozlesme). Groovy her dala ayni anda
//     uygulanir; yeni bir npm betigi cagirirsa o betigi tasimayan dal "Missing script" ile kirilir (is #46).
//     Derleme adimlari (kur, kapsam, build, paket) scripts/kurumsal-derle.cjs'te, kodla birlikte surumlenir;
//     adim degisikligi groovy degisikligi GEREKTIRMEZ.
//   - kurumsal:derle paketi build/BMWPORTAL/PORTAL-BMW-main'e yazar: kutuphanenin Sonar adimi build/**'i
//     tarama disi birakir, zip adimi calisma alani icinden okur. War'in koku PORTAL-BMW-main/ (release.sh).
//   - BMWPORTAL.war ve BMWPORTAL-D: uygulamanin SI/CMDB kaydindaki war ve deployment adlari.
p = standardPipeline (
    global: [
        email: [
            to: 'EKIP_EPOSTA_ADRESI',
            failed: true
        ]
    ],
    checkout: [
        project: 'JAVASCRIPT',
        repository: 'GAR_BMW_PORTAL'
    ],
    build: [
        type: "npm",
        tools: [nodejs: "22.23.4"],
        commands: [
            "install",
            "run kurumsal:derle"
        ],
        compress: [from: "build/BMWPORTAL", to: "BMWPORTAL/BMWPORTAL.war"]
    ],
    copyToStagingArea: [
        artifactsToCopy: 'BMWPORTAL/*.war'
    ],
    deploy: [
        deploymentPlatform: 'JAVA',
        configurationName: 'BMWPORTAL-D'
    ]
)
