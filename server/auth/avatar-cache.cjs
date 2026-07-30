// server/auth/avatar-cache.cjs — Kullanici avatarlari icin ayri, sinirli-boyutlu cache.
//
// Eskiden LDAP fotografi (base64 data-URL, 5-30KB/kullanici) online-kullanici TAKIP
// yapisinin (_onlineUsers Map'i) icinde tutuluyordu — presence tracking (kim online, ne
// zaman gorulmus) ile buyuk ikili veri depolama (fotograf) ayni Map'te karisiyordu, hicbir
// boyut sinirlamasi yoktu (kurumsal AI kod incelemesi, review.md #18). Bu modul avatar'i
// presence takibinden tamamen AYIRIR, kendi LRU + sabit-boyut sinirini tasir.
'use strict';

const AVATAR_CACHE_MAX = 500;
const _avatarCache = new Map(); // username (lowercase) → data:URL string

function cacheAvatar(username, dataUrl) {
  if (!username || !dataUrl) return;
  const key = username.toLowerCase();
  if (_avatarCache.has(key)) _avatarCache.delete(key); // LRU: move-to-end
  if (_avatarCache.size >= AVATAR_CACHE_MAX) {
    const oldest = _avatarCache.keys().next().value;
    _avatarCache.delete(oldest);
  }
  _avatarCache.set(key, dataUrl);
}

function getAvatar(username) {
  if (!username) return null;
  return _avatarCache.get(String(username).toLowerCase()) || null;
}

module.exports = { cacheAvatar, getAvatar };
