-- 2026-07-27-envanter-navgroup.sql
-- Envanter'i "Genel" grubundan ayirip kendi ust-seviye grubuna tasir.
--
-- NEDEN GEREKLI: src/config/elements.ts icindeki NAV_GROUPS yalnizca FALLBACK'tir.
-- Sidebar (PageNav.tsx) once /api/visibility/nav-groups'u cagirir; DB'de nav_group
-- satirlari varsa frontend sabiti HIC KULLANILMAZ. seedPortalElements() de idempotent
-- oldugu icin (var olan element_key'i atlar) mevcut kurulumda parent_key'i duzeltmez.
-- Bu migration o yuzden elle calistirilir.
--
-- Calistirma:
--   sqlcmd -S TBMWANSALS.fw.garanti.com.tr,1453 -d TBMWANS -U TBMWANS_usr -P '***' \
--          -i deploy/sql/2026-07-27-envanter-navgroup.sql
--
-- Idempotent: birden fazla kez calistirilabilir.

SET NOCOUNT ON;
BEGIN TRANSACTION;

-- 1) Yeni nav grubu (yoksa olustur)
IF NOT EXISTS (SELECT 1 FROM portal_elements WHERE element_key = 'navgroup:envanter')
BEGIN
    INSERT INTO portal_elements
        (element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible)
    VALUES
        ('navgroup:envanter', 'nav_group', NULL, N'Envanter', NULL, 2, 1, 1);
    PRINT '[+] navgroup:envanter olusturuldu';
END
ELSE
    PRINT '[=] navgroup:envanter zaten var';

-- 2) Envanter sayfasini yeni gruba tasi
UPDATE portal_elements
   SET parent_key = 'navgroup:envanter',
       sort_order = 1,
       updated_at = GETUTCDATE()
 WHERE element_key = 'Envanter'
   AND element_type = 'page';
PRINT '[>] Envanter sayfasi navgroup:envanter altina tasindi';

-- 3) Diger gruplarin sirasini kaydir (Envanter 2. sirada dursun)
UPDATE portal_elements SET sort_order = 3, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:logx';
UPDATE portal_elements SET sort_order = 4, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:performance';
UPDATE portal_elements SET sort_order = 5, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:operasyon';
UPDATE portal_elements SET sort_order = 6, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:otomasyon';
UPDATE portal_elements SET sort_order = 7, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:ai';
UPDATE portal_elements SET sort_order = 8, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:kaynaklar';
UPDATE portal_elements SET sort_order = 9, updated_at = GETUTCDATE() WHERE element_key = 'navgroup:admin';

-- 4) Dashboard "Genel" altinda tek oge olarak kalsin
UPDATE portal_elements
   SET parent_key = 'navgroup:genel',
       sort_order = 1,
       updated_at = GETUTCDATE()
 WHERE element_key = 'Dashboard'
   AND element_type = 'page';

COMMIT TRANSACTION;

-- 5) Dogrulama — beklenen cikti: Genel->Dashboard, Envanter->Envanter
SELECT g.sort_order AS grup_sira,
       g.element_key AS grup,
       g.label       AS grup_adi,
       p.element_key AS sayfa
  FROM portal_elements g
  LEFT JOIN portal_elements p
         ON p.parent_key = g.element_key AND p.element_type = 'page'
 WHERE g.element_type = 'nav_group'
 ORDER BY g.sort_order, p.sort_order;
