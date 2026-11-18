@Library('standart-pipeline')

// Kurumsal Jenkins isi (standart_pipeline kutuphanesi). Bu dosya kurumsal is tanimi deposundaki
// kopyanin KAYNAGIDIR; degisiklik once burada yapilir, sonra oraya kopyalanir.
//
// KURUMSAL KOPYADA: `EKIP_EPOSTA_ADRESI` yerine ekip e-posta adresi yazilir. Gercek adres public
// repoya yazilmaz (bekci: server/__tests__/kurumsal-pipeline.test.cjs).
//
// Neden boyle (docs/KALITE-KAPILARI.md "Kurumsal Jenkins"):
//   - nodejs: kutuphanenin izin listesindeki surum; Dockerfile ile ayni.
//   - "run test:coverage": Sonar kapsami. coverage/lcov.info calisma alaninda uretilir; kutuphanenin
//     Sonar adimi onu `**/coverage/lcov.info` deseniyle bulur. Bu adim yoksa kapsam %0 gorunur.
//   - Paket depo DISINDA uretilir: Sonar calisma alaninin tamamini kaynak saydigi icin icerde ikinci
//     bir kopya olmamali.
def PAKET = '../DVL_JAVASCRIPT_GAR_BMW_PORTAL-paket'

p = standardPipeline (
    global: [ email: [ to: 'EKIP_EPOSTA_ADRESI', failed: true ] ],
    checkout: [ project: 'JAVASCRIPT', repository: 'GAR_BMW_PORTAL' ],
    build: [
        type: "npm",
        tools: [nodejs: "22.23.4"],
        commands: [
            "install",
            "run kur",
            "run test:coverage",
            "run build",
            "run paket -- --cikti ${PAKET}/PORTAL-BMW-main --derleme-yok"
        ],
        compress: [from: PAKET, to: "outdir/PORTAL-BMW-main.zip"]
    ],
    copyToStagingArea: [ artifactsToCopy: 'outdir/PORTAL-BMW-main.zip' ]
)
