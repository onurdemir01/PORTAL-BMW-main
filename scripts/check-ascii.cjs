#!/usr/bin/env node
// scripts/check-ascii.cjs — Turkce karakter guard'i (lint:ascii).
// Kural: server kodunda YORUM satirlari ve console.* LOG satirlari ASCII olmali.
// String literaller (UI/API mesajlari, DB seed degerleri) kapsam DISIdir — urun dili
// Turkce kalir. Ihlal bulursa dosya:satir listeler ve exit 1 doner (CI guard).
// Otomatik duzeltme: `npm run fix:ascii` (scripts/fix-ascii.cjs).
//
// Istisna: bir satiri bilerek haric tutmak icin satir sonuna `ascii-ok` yazin.
// Kuralin tanimi (dosyalar, yorum / log bolumu): scripts/ascii-kurali.cjs.
'use strict';

const fs = require('fs');
const { TR_RE, kaynakDosyalari, denetlenenBolumler } = require('./ascii-kurali.cjs');

// Dosya kumesi ve satirin denetlenen bolumu scripts/ascii-kurali.cjs'te (duzeltici ile ORTAK).
const violations = [];
for (const file of kaynakDosyalari()) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  for (const { satir, bas, son } of denetlenenBolumler(lines)) {
    if (TR_RE.test(lines[satir].slice(bas, son))) {
      violations.push(`${file}:${satir + 1}: ${lines[satir].trim().slice(0, 100)}`);
    }
  }
}

if (violations.length) {
  // KAPI YENIDEN BLOKE EDIYOR (exit 1).
  //
  // 2026-09-04'te kapi bilerek gevsetilmisti (blok yerine uyari) cunku o an 122
  // birikmis ihlal vardi ve hicbir isi bloke etmemesi tercih edildi. Ama betigin
  // KENDI BASLIGI hala "exit 1 doner (CI guard)" diyordu ve Jenkinsfile yorumu da
  // kapiyi kirmizi saniyordu: kapi ACIKTI, belge KAPALI diyordu.
  //
  // Ihlaller temizlendi (123 satir, YALNIZCA yorum bolumleri — yorumlar atildiginda
  // 42 dosyanin kodu BIREBIR ayni kaldi) ve kapi geri kapatildi. Yasanabilir olmasi
  // icin `npm run fix:ascii` ile otomatik duzeltme yolu da eklendi: bir kalite
  // kapisi ancak duzeltmesi ucuzsa kalici olur.
  console.error(`[lint:ascii] ${violations.length} ihlal bulundu:`);
  for (const v of violations.slice(0, 50)) console.error('  ' + v);
  if (violations.length > 50) console.error(`  ... ve ${violations.length - 50} tane daha`);
  console.error('');
  console.error('  Duzeltmek icin: npm run fix:ascii');
  console.error('  Bilerek istisna icin satir sonuna: ascii-ok');
  process.exit(1);
} else {
  console.log('[lint:ascii] OK — yorum/log satirlari ASCII.');
}
