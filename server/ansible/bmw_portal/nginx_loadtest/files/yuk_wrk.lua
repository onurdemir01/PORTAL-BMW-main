-- yuk_wrk.lua - Portal Nginx Hub "Yuk Testi" icin wrk betigi (wrk >= 4.0; LuaJIT / Lua 5.1). wrk_kos.sh cagirir.
-- Kaynak  : Portal'a ozgu (el kitinde yok). Agirlikli secim yuk_k6.js sec() ile, basliklar yuk_k6.js basliklar() ile AYNI.
-- Model   : KAPALI DONGU. Her baglanti her isteginden once delay() kadar bekler, EN AZ D = ceil(BAGLANTI * 1000 /
--           TAVAN_RPS) ms: toplam hiz ORTALAMADA <= BAGLANTI * 1000 / D <= TAVAN_RPS. wrk tum baglantilari birlikte
--           acar ve sabit bekleme fazlari korur (kume); bu yuzden is parcacigi basina ilk BAGLANTI / IS_PARCACIGI delay()
--           D + math.random(0, D - 1) doner (ilk istekler rastgele [D, 2D) araligina yayilir), sonrakiler D. Her bekleme
--           >= D kalir; istekler yine kumelenebilir, anlik hiz burst'u asabilir (README "Tuzaklar"). Gecikme olcumu
--           beklemeyi ICERMEZ (wrk istegin baslangicini istek yazilirken alir).
-- Istek   : YALNIZ Host, Accept-Encoding (AE_DEGER), User-Agent <UA_ONEK>/<TUR>/<FAZ>/<DENEME> ve yalniz KIP=yeni iken
--           Connection: close. Cerez, vekil, yonlendirme yok. Her yolun istegi init()'te bir kez uretilir (yol basina
--           YENI baslik tablosu: wrk.format tabloyu degistirir).
-- Durma   : ilk 429 ya da >= 500 yanitta is parcacigi wrk.thread:stop() ile yuk uretmeyi keser (kapali dongude hizli
--           donen hata yanitlari hizi buyutur); DUR karari wrk_kos.sh'te ozetten verilir.
-- Sayaclar: s1xx s2xx s3xx s429 s4xx s5xx sdiger AYRI GLOBAL sayilar; done() her is parcacigindan thread:get ile YALNIZ
--           ilkel deger okur (tablo degerli thread:get is parcacigi yiginini bozar).
-- Ozet    : done() WRK_OZET dosyasina OZET_ANAHTARLARI sirasiyla 21 satir anahtar<TAB>tamsayi yazar (.tmp + os.rename);
--           gecikmeler mikrosaniye, wrk'nin koordineli ihmal duzeltmeli dagilimi. Gecersiz deger: error (dosya yazilmaz).
-- Ortam   : HOST_BASLIGI UA_ONEK TUR DENEME KIP AE FAZ BAGLANTI IS_PARCACIGI TAVAN_RPS SENARYO WRK_OZET (dogrulama init()'te;
--           arguman kullanilmaz; IS_PARCACIGI wrk'nin -t degeri: 1..16 ve BAGLANTI'yi tam boler). LUA_YUKLEME_ISARETI
--           yalniz wrk_kos.sh'in yukleme sinamasinda verilir: dosyanin SONUNDAKI blok o dosyaya 'yuklendi' yazar (betik
--           sonuna kadar yuklendi kaniti; gercek kosuda verilmez).
-- Kural   : ust duzeyde yalniz yorum, local tanim, global setup/init/delay/request/response/done ve en sonda tek do ... end
--           blogu: wrk betik yukleme hatasini yalniz stderr'e yazar ve VARSAYILAN istekle yuke devam eder (README "Tuzaklar").

local AE_DEGER = { br = 'gzip, deflate, br, zstd', gzip = 'gzip', identity = 'identity' }
local KIPLER = { yeni = true, ka = true }
local FAZLAR = { isinma = true, olcum = true }
local YOL_DESENI = "^/[%w%._~!%$&'%(%)%*%+,;=:@%%/%-]*$"
local SAYACLAR = { 's1xx', 's2xx', 's3xx', 's429', 's4xx', 's5xx', 'sdiger' }
local OZET_ANAHTARLARI = { 'surum', 'istek', 'bayt', 'sure_us', 'e_connect', 'e_read', 'e_write', 'e_timeout', 'e_status', 's1xx', 's2xx', 's3xx', 's429', 's4xx', 's5xx', 'sdiger', 'lat_max_us', 'p50_us', 'p95_us', 'p99_us', 'is_parcacigi' }
local threads = {}
local K, ISTEKLER, TOPLAM, N_YOL, DURDU, GECIKME_MS, ILK_KALAN = {}, {}, 0, 0, false, 0, 0
local HOST, UA_ONEK, TUR, FAZ, DENEME, KIP, AE, BAGLANTI, IS_PARCACIGI, TAVAN

local function ortam(ad, desen)
  local v = os.getenv(ad)
  if v == nil or v == '' then error('yuk_wrk.lua: ' .. ad .. ' verilmedi') end
  if desen and not string.find(v, desen) then error('yuk_wrk.lua: ' .. ad .. ' gecersiz') end
  return v
end

local function kolonlar(satir)
  local k = {}
  for parca in string.gmatch(satir .. '\t', '([^\t]*)\t') do k[#k + 1] = parca end
  return k
end

function setup(thread)
  threads[#threads + 1] = thread
  thread:set('id', #threads)
end

function init(args)
  if wrk.thread == nil then error('yuk_wrk.lua: wrk.thread yok (wrk 4.0 ya da ustu gerekir)') end
  HOST = ortam('HOST_BASLIGI', '^[a-z0-9][a-z0-9%.%-]*$')
  UA_ONEK = ortam('UA_ONEK', '^[a-z][a-z0-9%-]+$')
  if #UA_ONEK < 3 or #UA_ONEK > 31 then error('yuk_wrk.lua: UA_ONEK gecersiz') end
  TUR = ortam('TUR', '^[%w_%-]+$')
  DENEME = ortam('DENEME', '^[1-9][0-9]*$')
  KIP = ortam('KIP')
  if not KIPLER[KIP] then error('yuk_wrk.lua: KIP gecersiz') end
  AE = ortam('AE')
  if not AE_DEGER[AE] then error('yuk_wrk.lua: AE gecersiz') end
  FAZ = ortam('FAZ')
  if not FAZLAR[FAZ] then error('yuk_wrk.lua: FAZ gecersiz') end
  BAGLANTI = tonumber(ortam('BAGLANTI', '^[1-9][0-9]*$'))
  if BAGLANTI > 199 then error('yuk_wrk.lua: BAGLANTI 1..199 olmali') end
  IS_PARCACIGI = tonumber(ortam('IS_PARCACIGI', '^[1-9][0-9]*$'))
  if IS_PARCACIGI > 16 or BAGLANTI % IS_PARCACIGI ~= 0 then error('yuk_wrk.lua: IS_PARCACIGI 1..16 olmali ve BAGLANTI sayisini tam bolmeli') end
  TAVAN = tonumber(ortam('TAVAN_RPS', '^[1-9][0-9]*$'))
  if TAVAN > 450 then error('yuk_wrk.lua: TAVAN_RPS 1..450 olmali') end
  local f = io.open(ortam('SENARYO'), 'r')
  if f == nil then error('yuk_wrk.lua: SENARYO okunamadi') end
  for satir in f:lines() do
    satir = string.gsub(satir, '\r$', '')
    if satir ~= '' and string.sub(satir, 1, 1) ~= '#' then
      local k = kolonlar(satir)
      local w = tonumber(k[1])
      if #k ~= 5 or w == nil or not (w > 0) or not string.find(k[5], YOL_DESENI) then
        f:close()
        error('yuk_wrk.lua: SENARYO satiri gecersiz (5 SEKME kolonu, agirlik > 0, yol beyaz listede)')
      end
      local b = { Host = HOST, ['Accept-Encoding'] = AE_DEGER[AE], ['User-Agent'] = UA_ONEK .. '/' .. TUR .. '/' .. FAZ .. '/' .. DENEME }
      if KIP == 'yeni' then b['Connection'] = 'close' end
      TOPLAM = TOPLAM + w
      N_YOL = N_YOL + 1
      K[N_YOL] = TOPLAM
      ISTEKLER[N_YOL] = wrk.format('GET', k[5], b)
    end
  end
  f:close()
  if N_YOL == 0 then error('yuk_wrk.lua: SENARYO bos') end
  s1xx, s2xx, s3xx, s429, s4xx, s5xx, sdiger = 0, 0, 0, 0, 0, 0, 0
  GECIKME_MS = math.ceil(BAGLANTI * 1000 / TAVAN)
  ILK_KALAN = BAGLANTI / IS_PARCACIGI
  math.randomseed(os.time() + (tonumber(id) or 0) * 7919)
end

function delay()
  if ILK_KALAN > 0 then
    ILK_KALAN = ILK_KALAN - 1
    return GECIKME_MS + math.random(0, GECIKME_MS - 1)
  end
  return GECIKME_MS
end

function request()
  local r = math.random() * TOPLAM
  local lo, hi = 1, N_YOL
  while lo < hi do
    local m = math.floor((lo + hi) / 2)
    if K[m] > r then hi = m else lo = m + 1 end
  end
  return ISTEKLER[lo]
end

function response(status, headers, body)
  if status == 429 then s429 = s429 + 1
  elseif status < 200 then s1xx = s1xx + 1
  elseif status < 300 then s2xx = s2xx + 1
  elseif status < 400 then s3xx = s3xx + 1
  elseif status < 500 then s4xx = s4xx + 1
  elseif status < 600 then s5xx = s5xx + 1
  else sdiger = sdiger + 1 end
  if (status == 429 or status >= 500) and not DURDU then
    DURDU = true
    wrk.thread:stop()
  end
end

function done(summary, latency, requests)
  local yol = os.getenv('WRK_OZET')
  if yol == nil or yol == '' then error('yuk_wrk.lua: WRK_OZET verilmedi') end
  local top = {}
  for _, ad in ipairs(SAYACLAR) do top[ad] = 0 end
  for _, t in ipairs(threads) do
    for _, ad in ipairs(SAYACLAR) do
      local v = t:get(ad)
      if type(v) ~= 'number' then error('yuk_wrk.lua: ' .. ad .. ' sayaci okunamadi') end
      top[ad] = top[ad] + v
    end
  end
  local e = summary.errors
  local d = { surum = 1, istek = summary.requests, bayt = summary.bytes, sure_us = summary.duration,
              e_connect = e.connect, e_read = e.read, e_write = e.write, e_timeout = e.timeout, e_status = e.status,
              lat_max_us = latency.max, p50_us = latency:percentile(50), p95_us = latency:percentile(95),
              p99_us = latency:percentile(99), is_parcacigi = #threads }
  for _, ad in ipairs(SAYACLAR) do d[ad] = top[ad] end
  local satirlar = {}
  for _, ad in ipairs(OZET_ANAHTARLARI) do
    local v = d[ad]
    if type(v) ~= 'number' or v ~= v or v < 0 or v == math.huge then error('yuk_wrk.lua: ozet degeri gecersiz: ' .. ad) end
    satirlar[#satirlar + 1] = ad .. '\t' .. string.format('%.0f', v) .. '\n'
  end
  local gecici = yol .. '.tmp'
  local f = io.open(gecici, 'w')
  if f == nil then error('yuk_wrk.lua: ozet dosyasi acilamadi: ' .. gecici) end
  f:write(table.concat(satirlar))
  f:close()
  local ok, neden = os.rename(gecici, yol)
  if not ok then error('yuk_wrk.lua: ozet dosyasi tasinamadi: ' .. tostring(neden)) end
end

do
  local isaret = os.getenv('LUA_YUKLEME_ISARETI')
  if isaret ~= nil and isaret ~= '' then
    local f = io.open(isaret, 'w')
    if f then
      f:write('yuklendi\n')
      f:close()
    end
  end
end
