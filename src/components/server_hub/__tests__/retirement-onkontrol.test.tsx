// Retirement STOP ön kontrol listesi (2026-10-22): komutlar / uygulama / konfigürasyon / dosyalar /
// dokunulmayacaklar açıkça görünür; izin listesi yoksa onay açılmaz.
import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { RtTarget } from '@/api/retirementApi';
import OnKontrolListesi, { onKontrolAyristir, onKontrolHazir } from '../RetirementOnKontrol';

const SATIRLAR = [
  'ONKONTROL\tuygulama\tGBPOSWEBAPI\tJBoss 7 - kurulum /usr/jboss/AppServer, controller GBJEXP05, host=master; su an STARTED, auto-start=true',
  'ONKONTROL\tkonfig\t/host=master/server-config=GBPOSWEBAPI\tauto-start: true -> false (sunucu acilisinda kalkmaz)',
  'ONKONTROL\tkonfig\t/server-group=GBPOSWEBAPI_Group\tsunucular durdurulur: STARTED -> STOPPED/DISABLED',
  'ONKONTROL\tkomut\t/host=master/server-config=GBPOSWEBAPI:write-attribute(name=auto-start,value=false)\tDEGISTIRIR - auto-start kapatilir',
  'ONKONTROL\tkomut\t/server-group=GBPOSWEBAPI_Group:stop-servers\tDEGISTIRIR - JVM durdurulur',
  'ONKONTROL\tkomut\tls host=master/server-config=GBPOSWEBAPI\tsalt okunur - durum okuma',
  'ONKONTROL\tkomut\tmv -- /vhosting/GBPOSWEBAPI.ear /vhosting/GBPOSWEBAPI.ear.23523236.old\tDEGISTIRIR - dosya sistemi, yeniden adlandirma (SILME YOK)',
  'ONKONTROL\tdosya\t/vhosting/GBPOSWEBAPI.ear\t/vhosting/GBPOSWEBAPI.ear.23523236.old',
  'ONKONTROL\tdokunulmaz\t/vhosting8\tJBoss 8 dizini - aranmaz, hicbir dosyasina dokunulmaz',
  'ONKONTROL\tdokunulmaz\t/hysdeploy\t/hysdeploy taranmaz: JBoss 8 dizininde /vhosting8/GBPOSWEBAPI.ear',
  'ONKONTROL\tozet\t3 degistiren islem, 1 dosya\tOnaydan sonra YALNIZ bu listedeki islemler yapilir',
  'STEP\tdurum\tOK\tgurultu - ON KONTROL satiri degil',
];

const hedef = (o: Partial<RtTarget> = {}): RtTarget => ({
  id: 1, recordId: 1, host: 'GBJEXP05', site: 'Pendik', env: 'PROD', appName: 'GBPOSWEBAPI', gen: 7, appPath: '/vhosting/GBPOSWEBAPI.ear',
  web: [], status: 'planned', planText: 'PLAN', resultText: null, lastJobId: 10, deleteJobId: null, stoppedAt: null, updatedAt: '',
  deletedAt: null, rolledBackAt: null, rollbackJobId: null, scheduledAt: null, windowEnd: null, webSonuc: null,
  detail: { steps: [], renamed: [], onkontrol: SATIRLAR },
  stopIzin: { jobId: 10, at: null, izinler: ['onay:GBPOSWEBAPI|JBoss7|GBJEXP05', 'mv:/vhosting/GBPOSWEBAPI.ear'] },
  ...o,
});

describe('Retirement ön kontrol listesi', () => {
  test('OKU1 satırlar türlerine ayrılır; ONKONTROL olmayan satır atılır', () => {
    const g = onKontrolAyristir(SATIRLAR);
    expect(g.uygulama).toHaveLength(1);
    expect(g.konfig.map((x) => x.ne)).toEqual(['/host=master/server-config=GBPOSWEBAPI', '/server-group=GBPOSWEBAPI_Group']);
    expect(g.komut).toHaveLength(4);
    expect(g.dosya[0]).toEqual({ tur: 'dosya', ne: '/vhosting/GBPOSWEBAPI.ear', ayrinti: '/vhosting/GBPOSWEBAPI.ear.23523236.old' });
    expect(g.dokunulmaz.map((x) => x.ne)).toEqual(['/vhosting8', '/hysdeploy']);
  });

  test('OKU2 ekranda uygulama, konfigürasyon, komutlar (değiştiren / salt okunur), dosyalar ve dokunulmayacaklar görünür', () => {
    render(<OnKontrolListesi t={hedef()} />);
    expect(screen.getByText('Uygulama')).toBeInTheDocument();
    expect(screen.getByText('Değişecek konfigürasyon')).toBeInTheDocument();
    expect(screen.getByText(/Çalışacak komutlar \(3 değiştiren, 1 salt okunur\)/)).toBeInTheDocument();
    expect(screen.getByText('/server-group=GBPOSWEBAPI_Group:stop-servers')).toBeInTheDocument();
    expect(screen.getByText(/Etkilenecek dosyalar/)).toBeInTheDocument();
    expect(screen.getByText('Dokunulmayacaklar')).toBeInTheDocument();
    expect(screen.getByText('/vhosting8')).toBeInTheDocument();
    expect(screen.getByText(/yalnız bu listedeki/)).toBeInTheDocument();
    expect(screen.getAllByText('değiştirir')).toHaveLength(3);
  });

  test('OKU3 liste gelmediyse (eski betik) uyarı: onay açılmaz', () => {
    render(<OnKontrolListesi t={hedef({ detail: { steps: ['STEP\tplan\tPLAN\tx'], renamed: [] }, stopIzin: null })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Ön kontrol listesi gelmedi.*onay açılmaz/);
  });

  test('OKU4 onay yalnız izin listesinde onay kimliği varsa hazır', () => {
    expect(onKontrolHazir(hedef())).toBe(true);
    expect(onKontrolHazir(hedef({ stopIzin: null }))).toBe(false);
    expect(onKontrolHazir(hedef({ stopIzin: { jobId: 10, at: null, izinler: ['mv:/x'] } }))).toBe(false);
  });
});
