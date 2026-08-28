// src/components/telnet/steps/TelnetInputStep.tsx — Telnet testinin son adımı:
// hedef IP/host ve port. OpsX'teki OperationStep'in yerini alır — burada bir "işlem"
// değil, tek bir bağlantı testi tetiklenir.
import React, { useState } from "react";

const IP_PORT_RE = /^[A-Za-z0-9.\-:_]{1,255}$/;

const TelnetInputStep: React.FC<{
  summary: React.ReactNode;
  busy?: boolean;
  /** "Aynı hedeflerle tekrar" akışında önceki değerlerle dolu gelir — kullanıcı
   *  genellikle YALNIZCA portu değiştirmek ister ve IP'yi yeniden yazmak zorunda
   *  kalması bu akışın anlamını yok ederdi. */
  initial?: { ip: string; port: string } | null;
  onSubmit: (v: { ip: string; port: string }) => void;
}> = ({ summary, busy, initial, onSubmit }) => {
  const [ip, setIp] = useState(initial?.ip ?? "");
  const [port, setPort] = useState(initial?.port ?? "");

  const ipTrim = ip.trim();
  const portTrim = port.trim();
  const portNum = Number(portTrim);
  const ipValid = IP_PORT_RE.test(ipTrim);
  const portValid = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const ready = ipValid && portValid;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Telnet testi yapılacak hedefi girin</p>
        <div className="mt-1 text-xs text-[var(--text-muted)]">{summary}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">IP / Host</label>
          <input
            autoFocus
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="10.10.1.101"
            className="w-full px-3 py-2 text-sm font-mono border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
          />
          {ipTrim && !ipValid && <p className="mt-1 text-xs text-red-600">Geçersiz karakter içeriyor.</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Port</label>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="8080"
            inputMode="numeric"
            className="w-full px-3 py-2 text-sm font-mono border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
          />
          {portTrim && !portValid && <p className="mt-1 text-xs text-red-600">1-65535 arası bir sayı olmalı.</p>}
        </div>
      </div>

      <button
        onClick={() => onSubmit({ ip: ipTrim, port: portTrim })}
        disabled={!ready || busy}
        className="btn-primary w-full flex items-center justify-center gap-1.5"
      >
        {busy ? "Gönderiliyor…" : "Telnet Testini Başlat"}
      </button>
    </div>
  );
};

export default TelnetInputStep;
