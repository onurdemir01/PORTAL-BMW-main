// Jenkinsfile — BMW Portal CI (declarative pipeline)
//
// GEREKSİNİMLER (Jenkins tarafında bir kez):
//  - NodeJS Plugin + Global Tool: "node20" adında Node.js 20.x tanımı
//
// AKIŞ: checkout → npm ci → kalite kapısı (tsc + lint:ascii + server syntax) →
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

    stage('Kalite Kapısı') {
      steps {
        sh 'npx tsc --noEmit'
        sh 'npm run lint:ascii'
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
