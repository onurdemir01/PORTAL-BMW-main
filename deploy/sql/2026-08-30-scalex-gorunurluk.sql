-- 2026-08-30 — ScaleX sayfasinin gorunurlugu.
--
-- NEDEN GEREKLI: `ScaleX` elementi `roles: ['Admin','User']` ile seed ediliyor ve bu,
-- elementi `default_visible = 0` yapar — gorunurlugunu YALNIZCA
-- `portal_element_visibility` satirlarindan alir. `mssql-setup.cjs` bu satirlari artik
-- element bazinda idempotent olarak yaziyor, yani sunucu yeniden baslayinca kendiliginden
-- olusur. Bu betik, sunucuyu yeniden baslatmadan ayni sonucu almak isteyen ya da
-- satirlarin olustugunu DOGRULAMAK isteyen ekip icin.
--
-- Idempotent: iki kez calistirmak zararsizdir.

-- 1) Element satiri yoksa ekle (normalde mssql-setup ekler).
IF NOT EXISTS (SELECT 1 FROM portal_elements WHERE element_key = 'ScaleX')
  INSERT INTO portal_elements (element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible)
  VALUES ('ScaleX', 'page', 'navgroup:otomasyon', N'ScaleX', '/scalex', 10, 1, 0);

-- 2) Rol kurallari — OpsX/LogX ile AYNI varsayilan (Admin + User).
--    Kisitlama sayfa bazinda degil, KAYNAK bazinda yapilir (namespace/uygulama).
IF NOT EXISTS (SELECT 1 FROM portal_element_visibility WHERE element_key = 'ScaleX' AND principal_id = 'Admin')
  INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
  VALUES ('ScaleX', 'role', 'Admin', 1);

IF NOT EXISTS (SELECT 1 FROM portal_element_visibility WHERE element_key = 'ScaleX' AND principal_id = 'User')
  INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
  VALUES ('ScaleX', 'role', 'User', 1);

-- 3) Dogrulama — iki satir donmeli (Admin, User).
SELECT element_key, principal_type, principal_id, allow
  FROM portal_element_visibility WHERE element_key = 'ScaleX';
