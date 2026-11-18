@Library('standart-pipeline')

// Kurumsal Jenkins isi (standart_pipeline). Bu dosya kurumsal is tanimi deposundaki kopyanin KAYNAGIDIR;
// degisiklik once burada yapilir, sonra oraya kopyalanir. KURUMSAL KOPYADA `EKIP_EPOSTA_ADRESI` yerine
// ekip e-posta adresi yazilir; gercek adres public repoya yazilmaz.
// Bekci: server/__tests__/kurumsal-pipeline.test.cjs. Ayrinti: docs/KALITE-KAPILARI.md "Kurumsal Jenkins".
//
//   - tools yalniz nodejs: kutuphane npm + yalniz nodejs icin Linux ajani (POD&&NODEJS) secer. Arac
//     verilmezse varsayilan ajana duser; derleme araclari (npm run kur) orada kurulamaz.
//   - run kur: derleme araclari (vite vb.) gelistirme/ agacindan; kokteki install yalniz calisma zamani.
//   - run kapsam:kurumsal: CI'in gercek testlerle urettigi kalite/kapsam raporunu, Sonar adiminin aradigi
//     coverage/lcov.info'ya koyar (bayatsa Sonar kosusunu dusurur). Testler burada kosturulmaz: npm
//     komutlarinin hepsi tek bir 15 dk zaman asimi icinde.
//   - paket build/ altinda: kutuphanenin Sonar adimi build/**'i tarama disi birakir (cift tarama olmaz) ve
//     zip adimi calisma alani icinden okur. War'in koku PORTAL-BMW-main/ (deploy/release.sh bunu bekler).
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
            "run kur",
            "run kapsam:kurumsal",
            "run build",
            "run paket -- --cikti build/BMWPORTAL/PORTAL-BMW-main --derleme-yok"
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
