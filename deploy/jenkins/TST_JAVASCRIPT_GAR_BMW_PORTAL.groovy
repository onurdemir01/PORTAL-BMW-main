@Library('standart-pipeline')

// Kurumsal Jenkins isi, TST ortami. Derleme, paket, war ve staging DVL ile BIREBIR aynidir; gerekceler
// DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy basliginda. Fark yalniz deployment adi: BMWPORTAL-T (kurumdaki
// -D / -T / -Q kalibi; TST SI kaydiyla dogrulanmali). KURUMSAL KOPYADA `EKIP_EPOSTA_ADRESI` yerine ekip
// e-posta adresi yazilir. Bekci: server/__tests__/kurumsal-pipeline.test.cjs.
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
        configurationName: 'BMWPORTAL-T'
    ]
)
