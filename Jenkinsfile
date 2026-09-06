// Jenkinsfile — BMW Portal CI (declarative pipeline)
//
// GEREKSİNİMLER (Jenkins tarafında bir kez):
//  - NodeJS Plugin + Global Tool: "node20" adında Node.js 20.x tanımı
//
// AKIŞ: checkout → npm ci → testler (node:test + vitest) →
//       kalite kapısı (tsc + lint:ascii + eslint + server syntax) →
//       build → paket → arşiv (indirilebilir artifact).
//
// NOT — DEPLOY BU PIPELINE'DA YOK: gerçek sunucuya (gblabt02, /vhosting8/bmw_portal)
// kurulum SSH/CI ile değil, MANUEL zip → deploy/release.sh <env> akışıyla yapılır
// (bkz. docs/DEPLOYMENT.md). Eski SSH+scripts/deploy.sh modeli (/opt/bmw-portal,
// port 5055, JSON-store) artık gerçek altyapıyla uyuşmuyordu — arşivlendi:
// docs/archive/deploy-legacy.sh. Bu pipeline yalnızca derleme/paket doğrulaması yapar;
// üretilen artifact'i indirip elle deploy/release.sh ile sunucuya taşıyın.
pipeline {
  agent any

  tools { nodejs 'node20' }

  environment {
    // deploy/release.sh tam olarak bu adi + ic yapiyi (PORTAL-BMW-main/ kok klasoru)
    // bekler — artifact'i indirip dogrudan deploy/PORTAL-BMW-main.zip olarak sunucuya
    // kopyalamak yeterlidir, yeniden paketleme gerekmez.
    ARTIFACT = "PORTAL-BMW-main.zip"
    CI = 'true'
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '15', artifactNumToKeepStr: '5'))
    timeout(time: 30, unit: 'MINUTES')
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Install') {
      steps { sh 'node --version && npm ci --no-audit --no-fund' }
    }

    // TESTLER CI'DA KOSMALI. Uzun sure kosmuyorlardi: boru hatti tsc + lint + build
    // yapiyor ama `npm test` hic cagrilmiyordu — 900+ bekci yalnizca gelistirici
    // makinesinde calisiyordu ve "yesil CI" kosmayan testlerle de yesildi.
    //
    // `npm test` bir kosucuya (scripts/run-tests.cjs) baglidir: Node 22.3+ ise tum
    // suiti, daha eskiyse `mock.module` gerektiren dosyalari ATLAYARAK kalanini
    // kosar ve atladiklarini adiyla yazdirir. Boylece "node20" araciyla da calisir
    // ama neyin kosmadigi ciktida GORUNUR.
    // SIRA HALA BILEREK: testler KALITE KAPISINDAN ONCE. Gerekce DEGISTI ama sonuc
    // ayni: bir asama duserse sonrakiler HIC kosmaz ve davranis dogrulugu, yorum
    // karakterlerinden once gelir. (Eski gerekce artik gecersiz: `lint:ascii`in
    // 122 birikmis ihlali temizlendi ve kapi yeniden BLOKE ediyor.)
    //
    // VITEST DE BURADA. React bilesen testleri (WorkloadStep dahil) CI'da HIC
    // kosmuyordu: `npm test` node:test kosucusudur ve `src/**/__tests__/*.tsx`
    // dosyalarini gormez. Yani bilesen testleri de tam olarak `npm test`in bir
    // zamanlar dustugu duruma dusmustu — yazilmis, yesil sanilan, kosmayan testler.
    stage('Testler') {
      steps {
        sh 'npm test'
        sh 'npm run test:ui'
      }
    }

    stage('Kalite Kapısı') {
      steps {
        sh 'npx tsc --noEmit'
        sh 'npm run lint:ascii'
        // ESLINT DE CI'DA. Kuruldu (2026-09-04) ama boru hattinda HIC cagrilmiyordu.
        // Su an 0 HATA / 127 UYARI ile geciyor: kapi HATALARI yakalar, uyarilar
        // gorunur bir borc olarak kalir. Uyarilari da kirmiziya cevirmek
        // (`--max-warnings 0`) AYRI ve olculebilir bir is; sessizce dayatmak,
        // ilgisiz bir PR'i bloke etmek olurdu.
        sh 'npm run lint'
        // Backend dosyaları TS derlemesine girmez — sözdizimi kontrolü:
        sh '''
          for f in $(find server -name "*.cjs"); do
            node -c "$f" || { echo "SYNTAX FAIL: $f"; exit 1; }
          done
        '''
      }
    }

    stage('Build') {
      steps { sh 'npm run build' }
    }

    stage('Paket') {
      steps {
        // deploy/release.sh'in bekledigi "PORTAL-BMW-main/" kok klasoru + icerik: build
        // ciktisi + backend + bagimlilik manifestleri + deploy scriptleri. .env.* dosyalari
        // DAHIL DEGIL — sunucuda mevcut .env.<env> dosyalari release.sh otomatik korur.
        sh '''
          rm -rf PORTAL-BMW-main
          mkdir -p PORTAL-BMW-main
          cp -r dist server scripts deploy PORTAL-BMW-main/
          cp package.json package-lock.json .env.example PORTAL-BMW-main/
          zip -rq "$ARTIFACT" PORTAL-BMW-main
          rm -rf PORTAL-BMW-main
          ls -lh "$ARTIFACT"
        '''
        archiveArtifacts artifacts: "${ARTIFACT}", fingerprint: true
      }
    }
  }

  post {
    success { echo "OK Build ${env.BUILD_NUMBER} tamam — artifact arsivlendi. Sunucuya kurulum icin: docs/DEPLOYMENT.md (deploy/release.sh)." }
    failure {
      echo "✗ Build ${env.BUILD_NUMBER} BASARISIZ"
      // Bildirim entegrasyonu (placeholder — kurumdaki kanala göre birini açın):
      // mail to: 'ekip@sirket.com.tr', subject: "BMW Portal build ${env.BUILD_NUMBER} FAILED", body: env.BUILD_URL
      // slackSend channel: '#bmw-portal', message: "Build FAILED: ${env.BUILD_URL}"
    }
    always { cleanWs(deleteDirs: true, notFailBuild: true) }
  }
}
