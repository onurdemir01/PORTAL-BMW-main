// server/admin/system-config.cjs — Admin → Sistem sekmesi: whitelist'lenmis env
// degiskenlerini goruntuleme + duzenleme. Duzenleme artik portal_env_overrides
// tablosuna yazar (DB kalici) ve process.env'i gunceller — .env.local dosyasina
// yazilmaz; restart/redeploy sonrasi degisiklikler DB'den geri yuklenir (bkz.
// server/db/env-overrides.cjs loadEnvOverrides). Cogu modul env'i boot'ta okudugu
// icin yanit restartRequired:true doner.
'use strict';

const express = require('express');
const {
  SYSTEM_CONFIG_KEYS, setEnvOverride, isFromDb,
} = require('../db/env-overrides.cjs');
// server/db/env-overrides.cjs ile PAYLASILAN tek desen — eskiden iki dosyada birebir kopya
// tutuluyordu (kurumsal AI kod incelemesi, review.md #21); artik ikisi de bagimliliksiz
// server/config/secret-pattern.cjs'i require eder, dongusel bagimlilik riski yok.
const { SECRET_PATTERN } = require('../config/secret-pattern.cjs');

function maskValue(key, value) {
  if (!value) return "";
  if (!SECRET_PATTERN.test(key)) return value;
  if (value.length <= 6) return "•••";
  return `${value.slice(0, 2)}•••${value.slice(-2)}`;
}

function initSystemConfig(app) {
  app.get("/api/admin/system-config", (req, res) => {
    if (req.session?.user?.role !== "Admin") return res.status(403).json({ ok: false });
    const values = SYSTEM_CONFIG_KEYS.map((key) => {
      const raw = process.env[key] || "";
      const masked = SECRET_PATTERN.test(key);
      return {
        key,
        value: masked ? maskValue(key, raw) : raw,
        defined: !!raw,
        masked,
        // Kaynak bilgisi: bu deger admin tarafindan DB'ye yazilmis bir override mi?
        source: isFromDb(key) ? "db" : "env",
      };
    });
    res.json({ ok: true, values });
  });

  app.put("/api/admin/system-config", express.json(), async (req, res) => {
    if (req.session?.user?.role !== "Admin") return res.status(403).json({ ok: false });
    const { key, value } = req.body || {};
    if (!SYSTEM_CONFIG_KEYS.includes(key)) {
      return res.status(400).json({ ok: false, error: "Bu anahtar düzenlenemez." });
    }
    const strValue = String(value ?? "");
    if (strValue.includes("\n")) {
      return res.status(400).json({ ok: false, error: "Değer tek satır olmalı." });
    }
    try {
      await setEnvOverride(key, strValue, req.session.user.username);
      // Denetim kaydi — deger secret olabilir, yalnizca anahtar adi yazilir.
      try {
        require('../audit/index.cjs').auditPortal(req, 'system_config_update', {
          detail: `key=${key}${SECRET_PATTERN.test(key) ? ' (value redacted)' : ` value=${strValue.slice(0, 200)}`}`,
        });
      } catch { /* yoksay */ }
      console.log(`[Config] ${req.session.user.username} -> ${key} guncellendi (DB override).`);
      res.json({ ok: true, key, restartRequired: true, source: "db" });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log("[SystemConfig] admin env endpoints mounted at /api/admin/system-config");
}

module.exports = { initSystemConfig };
