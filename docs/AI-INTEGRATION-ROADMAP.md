# AI Entegrasyon Yol Haritası — 40 Madde

> LogX ↔ Dynatrace ↔ Instana ↔ AI Analist'i tek işlevsel dokuya dönüştürme backlog'u.
> Etiketler: **[✅ yapıldı]** · **[K]** kolay (≤1 gün) · **[O]** orta (2-4 gün) · **[Z]** zor (1+ hafta)
> Öncelik: ⭐⭐⭐ yüksek → ⭐ düşük. Mevcut altyapı: MCP factory, orkestratör (tool-use loop),
> portal araçları (`server/ai-analyst/portal-tools.cjs`), PII masker, SSE akışı.
>
> **Güncelleme (2026-07-11):** Sprint 1 uygulandı — madde 3 (kısmen), 12, 18, 22, 26 (güçlendirildi),
> 29, 30 (farklı bir tasarımla — aşağıda not edildi), 36 (minimal hâli) artık ✅. Ayrıca Dynatrace/
> Instana REST katmanına host/tag/managementZone/ekip filtreleri eklendi (roadmap'te ayrı madde
> değildi, bkz. `docs/QUICK-SOLVER.md`). Detaylı analiz + kalan fazlar için plan dosyası: bu
> güncellemeyi yapan oturumun planı (`server/ai-analyst/portal-tools.cjs`, `orchestrator.cjs`,
> `server/ansible/runner.cjs`, `src/components/dynatrace/DynatracePage.tsx` değişti).
>
> **Güncelleme (2026-07-11, ikinci geçiş):** Madde 13 ve 28 tamamlandı. Ayrıca Instana, Dynatrace
> ile aynı derinliğe getirildi: Issues/Events/Services alt-sekmeleri, ekip sahipliği zenginleştirmesi
> (`enrichWithTeamOwnership`, alan adı bilinmediği için jenerik anahtar denemesiyle) ve ham JSON
> yerine yapılandırılmış kartlar (bkz. `InstanaItemCard`, `DynatracePage.tsx`).
>
> **Madde 30 notu — tasarım sapması:** Orijinal madde "insan tek-tık onayı zorunlu" diyordu.
> Bunun yerine mevcut `portal_logx_fetch_log` emsali takip edildi: `portal_ansible_run_template`
> yalnızca zaten allowlist'te (salt-okunur/onaylı) olan template'leri, yalnızca **Admin rolündeki**
> sohbet oturumlarında, insan onay adımı OLMADAN doğrudan çalıştırabiliyor (audit'li). Allowlist
> dışı template'ler hâlâ yalnızca önerilir, çalıştırılmaz. Admin olmayan oturumlarda araç hiç
> görünmez — madde 29'daki "öneri modu" onlar için değişmeden geçerli.

## A. LogX ↔ AI (log tarafı)

1. **[✅] Envanterden host arama aracı** — LLM `portal_logx_list_hosts` ile doğru hostname'i kendisi bulur.
2. **[✅] Hosttan log çekme aracı** — `portal_logx_fetch_log` (Ansible, PII-maskeli, grep+satır limitli): "X hostuna git, Y logunu oku".
3. **[✅ kısmen] LogX oturumundan tek tık AI'a** — tam olarak "viewer'daki açık dosya yolunu yakala" değil, ama eşdeğeri yapıldı: (a) yeni `portal_logx_analyze_log` aracıyla MCP AI artık log çekme+analizi TEK adımda kendi kararıyla yapabiliyor (araçlı hâl), (b) LogX'ten handoff artık host adını da taşıyor, deep-dive mesajı host-context'li ve DT/Instana korelasyonunu açıkça istiyor.
4. **[K ⭐⭐] Çoklu dosya karşılaştırma** — aynı hostta iki log dosyasını (veya iki hostta aynı dosyayı) çekip diff-özet çıkaran hazır prompt şablonu.
5. **[O ⭐⭐] Zaman pencereli log çekme** — fetch_log'a `since/until` parametresi (Ansible template'ine timestamp filtresi ekleyerek) — "dün 14:00-15:00 arası".
6. **[O ⭐⭐⭐] Hata imzası çıkarma** — log analizinden üretilen "pattern imzaları"nın (regex) kaydedilip LogX'te tekrar aramada kullanılması.
7. **[O ⭐] Periyodik log nöbetçisi** — seçili host+dosya için zamanlanmış AI özeti (günlük "dünün hataları" raporu), sonuç panoya/maile.
8. **[K ⭐⭐] Maskeleme genişletme** — masker'a kurumsal desenler (müşteri no, sicil, iç IP aralıkları) için konfigüre edilebilir ek kurallar.
9. **[Z ⭐] Log akışı canlı izleme + anomali** — tail -f benzeri akışta AI'ın eşik/anomali yakalaması (SSE ile sürekli oturum).
10. **[K ⭐⭐] Analiz sonucunu LogX audit'e bağlama** — hangi kullanıcı hangi host/log için AI analizi çalıştırdı (audit action: ai_log_analysis).

## B. Dynatrace ↔ AI

11. **[✅] Managed tool seti orkestrasyonda** — 19 `dynatrace_managed_*` aracı LLM'e açık; alias listesi sistem promptunda.
12. **[✅] Problem kartından AI analizi** — Performance sayfasındaki problem detay modalına "AI ile kök neden" butonu eklendi → sohbeti problem başlığı+ID ile seed ediyor (bkz. `DynatracePage.tsx` `seedAiAnalystChat`).
13. **[✅] Dashboard problem rozetinden analiz** — Dashboard'daki "N Açık Dynatrace Sorunu" kartına ayrı bir "AI ile özetle" butonu eklendi (karta tıklamak hâlâ /performance'a götürür — davranış korunur), bkz. `DashboardPage.tsx` + paylaşılan `src/utils/aiHandoff.ts`.
14. **[O ⭐⭐⭐] Problem → log korelasyonu** — problem entity'sinden host adı çıkarıp portal_logx_fetch_log ile ilgili sunucu logunu otomatik çektiren zincir şablonu ("bu problemin loglardaki izini bul").
15. **[O ⭐⭐] Metrik anomali yorumu** — query_metrics_data sonucunu grafiğe dökmeden önce AI'ın eşik/kırılma yorumu; MetricsTab'a "AI yorumu" butonu.
16. **[K ⭐] Alias karşılaştırma** — aynı sorguyu test+prod alias'larında koşturup farkları özetleyen hazır prompt ("iki ortam arasındaki sağlık farkı").
17. **[O ⭐⭐] SLO raporu** — list_slos + get_slo_details'i haftalık özet rapora bağlama (AI yorumlu).
18. **[✅] Security problems taraması** — STARTER_PROMPTS'a "Açık güvenlik bulgularını (security problems) önceliklendir" eklendi.
19. **[O ⭐] Event tipi keşif yardımcısı** — kullanıcı serbest yazınca (ör. "restart olayları") doğru eventType'ı AI'ın seçmesi için event tipi kataloğunun prompta eklenmesi.
20. **[Z ⭐⭐] Problem kanalı bildirimi** — yeni CRITICAL problem düştüğünde AI özetiyle birlikte webhook/mail (poll + orkestratör tek atım).

## C. Instana ↔ AI

21. **[✅] Instana araçları önekli orkestrasyonda** — 9 `manage_*/analyze_*` aracı `instana__` önekiyle LLM'e açık; ortam istekte seçiliyor.
22. **[✅] Instana sağlık sekmesi** — DynatracePage'e 5. sekme olarak eklendi (env toggle, q araması, issue listesi) + "AI ile analiz et" köprüsü.
23. **[O ⭐⭐] DT↔Instana çapraz görünüm** — aynı servis için iki kaynaktan veri çekip tutarlılık özeti ("Dynatrace problem diyor, Instana ne görüyor?").
24. **[K ⭐] nonprod/prod fark analizi** — aynı Instana sorgusunun iki ortamda koşturulup fark raporu.
25. **[O ⭐] Instana release korelasyonu** — manage_releases verisiyle "bu hata deploy sonrası mı başladı?" zinciri.

## D. Çapraz senaryolar (asıl güç)

26. **[✅ kısmen] Log→DT çapraz doğrulama talimatı** — sistem promptu LLM'i log bulgusunu events/metrics ile doğrulamaya yönlendiriyor (senaryo chips'leri eklendi).
27. **[O ⭐⭐⭐] "Olay anlatısı" şablonu** — tek komutla: problem al → entity/host çöz → log çek → event'leri eşleştir → zaman çizelgeli anlatı üret (kök neden hikâyesi).
28. **[✅] Envanter bağlamı enjeksiyonu** — `portal_inventory_lookup` aracı eklendi: tek bir hostname için middleware/environment/notes/product_type/port dahil tam envanter kaydını döner (bkz. `server/ai-analyst/portal-tools.cjs`).
29. **[✅] Ansible çare önerisi (öneri modu)** — Admin olmayan oturumlarda sistem promptu AI'ı yalnızca öneri+Self Service linkine yönlendiriyor, çalıştırma yok.
30. **[✅ farklı tasarımla] Aksiyon çalıştırma** — insan onayı yerine Admin-only + allowlist + audit ile doğrudan çalıştırma (bkz. dosya başındaki "madde 30 notu").
31. **[K ⭐⭐] Rapor → görev** — AI analiz özetinden portal Görevler modülüne tek tık görev oluşturma (taskApi mevcut).
32. **[O ⭐] Nöbetçiye ilet** — kritik bulgu özetini günün nöbetçisine (nobetci API'den) mail/mesaj taslağı olarak hazırlama.

## E. UX / oturum

33. **[O ⭐⭐⭐] Sohbet geçmişi kalıcılığı** — oturumların MSSQL'e kaydı, geçmiş listesi + devam etme (şu an sayfa yenilenince kayboluyor).
34. **[K ⭐⭐] Paylaşılabilir analiz raporu** — sohbeti salt-okunur linke dönüştürme (markdown export + kısa URL).
35. **[K ⭐⭐] Kayıtlı analiz şablonları** — sık senaryoların (chips'in gelişmişi) kullanıcı bazlı kaydedilip parametreli çalıştırılması.
36. **[✅ minimal] Araç izin profilleri** — `getPortalTools(user)` artık `user.role`'e göre dallanıyor: aksiyon araçları (`portal_ansible_run_template`/`portal_ansible_job_status`) yalnızca Admin toolset'inde. Log fetch/analiz hâlâ herkese açık (ileride gruplama düşünülebilir).
37. **[K ⭐] Adım balonunda ham sonucu indirme** — tool_result'ın tam çıktısını .txt indirme.

## F. Operasyon / maliyet / güvenlik

38. **[K ⭐⭐] Maliyet sayacı** — istek başına token kullanımını (usage alanı) loglama + kullanıcı/gün bazlı rapor; aylık bütçe eşiğinde uyarı.
39. **[O ⭐⭐] Tool çağrı denetimi** — her orkestrasyon oturumunun araç çağrılarını (kim, hangi araç, hangi argümanlar) audit zincirine yazma.
40. **[O ⭐] Model kademesi** — basit sorgularda ucuz model, "olay anlatısı" gibi derin analizlerde güçlü model (istek başına model seçimi; provider katmanı hazır).
41. **[O ⭐] AWX job polling'i async'e çevirme** — `portal-tools.cjs`'teki `fetchRawLogLines`/`runReadOnlyAwxTemplate` şu an AWX job'ını başlatıp SSE bağlantısını 60s'e kadar açık tutarak (2s aralıklı polling) sonucu bekliyor. Event-loop'u bloklamıyor ve nginx `proxy_read_timeout 300s` bunu kapsıyor (kurumsal AI kod incelemesi Finding 27 — aktif risk değil, doğrulandı), ama ideal mimari: job ID'yi hemen dön + ayrı bir SSE `progress` event'i ile client tarafında polling veya webhook/callback tabanlı tamamlanma bildirimi. Daha genel LogX v2 job-takip modeliyle (`server/logx/v2/jobs.cjs`) birleştirilebilir.

---

## Önerilen ilk sprint (yüksek değer / düşük maliyet)

3, 12, 26→27, 33, 36, 38 — "problemden anlatıya" akışı + kalıcı oturum + izin/maliyet tabanı.
