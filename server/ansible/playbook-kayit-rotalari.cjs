// server/ansible/playbook-kayit-rotalari.cjs - Admin > Playbook Kayitlari: liste, silme ve
// silinen varsayilanlari geri yukleme uclari (2026-11-02). runner.cjs initAnsibleRunner
// buradan baglar; ayri modul cunku sahte app/registry ile davranis testi yapilabiliyor
// (server/ansible/__tests__/playbook-kayit-silme.test.cjs).
//
//   GET    /api/ansible/playbooks                                 - kayitlar + kullanan ozellik
//                                                                    + silinen varsayilanlar
//   DELETE /api/ansible/playbooks/:id                             - varsayilansa iz yazar
//   POST   /api/ansible/playbooks/silinen/:keyName/geri-yukle     - izi siler, seed'i ekler
//
// Her silme / geri yukleme portal_audit_logs'a ayrica (anahtar + varsayilan + kullanan) yazilir.
'use strict';

function kaydet(app, { requireAuth, requireAdmin, registry, kullanim, audit }) {
  const reg = () => registry || require('./playbook-registry.cjs');
  const kul = () => kullanim || require('./playbook-kullanim.cjs');
  const denetle = (req, action, detail) => {
    try {
      (audit || require('../audit/index.cjs').auditPortal)(req, action, {
        username: req.session?.user?.username || null,
        detail: JSON.stringify(detail),
      });
    } catch {
      /* audit yoksa yoksay */
    }
  };

  // Silinen varsayilanlar okunamazsa liste YINE doner; ekran bolumu "okunamadi" der
  // (bos "(0)" gostermek yanlis olurdu).
  app.get('/api/ansible/playbooks', requireAuth, requireAdmin, async (req, res) => {
    try {
      const r = reg();
      const rows = await r.listAll();
      const playbooks = rows.map((row) => ({
        ...row,
        effectiveTemplateId: r.getEffectiveTemplateId(row),
        varsayilan: !!r.varsayilanSatir(row.keyName),
        kullanan: kul().kullananOzellik(row.keyName),
      }));
      let silinenVarsayilanlar = null;
      let silinenHata = null;
      try {
        silinenVarsayilanlar = await r.listSilinenVarsayilanlar();
      } catch (err) {
        silinenHata = err.message || 'okunamadı';
      }
      res.json({ ok: true, playbooks, silinenVarsayilanlar, silinenHata });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.delete('/api/ansible/playbooks/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const sonuc = await reg().remove(req.params.id, { username: req.session?.user?.username || null });
      if (!sonuc) return res.status(404).json({ ok: false, message: 'Kayıt bulunamadı.' });
      const kullanan = kul().kullananOzellik(sonuc.keyName);
      denetle(req, 'playbook_kayit_sil', { keyName: sonuc.keyName, varsayilan: sonuc.varsayilan, kullanan });
      res.json({ ok: true, keyName: sonuc.keyName, varsayilan: sonuc.varsayilan, kullanan });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.post('/api/ansible/playbooks/silinen/:keyName/geri-yukle', requireAuth, requireAdmin, async (req, res) => {
    const keyName = String(req.params.keyName || '');
    if (!/^[a-z0-9_]+$/.test(keyName)) return res.status(400).json({ ok: false, message: 'Geçersiz anahtar adı.' });
    try {
      const row = await reg().geriYukle(keyName);
      denetle(req, 'playbook_varsayilan_geri_yukle', { keyName });
      res.json({ ok: true, playbook: row });
    } catch (err) {
      res.status(err.status === 400 ? 400 : 500).json({ ok: false, message: err.message });
    }
  });
}

module.exports = { kaydet };
