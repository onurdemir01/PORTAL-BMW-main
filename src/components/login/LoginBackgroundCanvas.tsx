import React, { useEffect, useRef } from "react";

// Login ekranının sol panelinde "arka planda video oynuyormuş" hissi veren,
// sürekli akan bir düğüm/bağlantı ağı (network topology) animasyonu — portalın
// sunucu/ağ izleme temasına uygun, saf Canvas + requestAnimationFrame ile
// (harici animasyon kütüphanesi/video dosyası gerektirmez).
const NODE_COUNT = 46;
const LINK_DIST = 130;
const ACCENT_RGB = "79, 142, 255"; // --accent (#0066CC)

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export default function LoginBackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let rafId = 0;
    let alive = true;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initNodes() {
      nodes = Array.from({ length: NODE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1 + Math.random() * 1.5,
      }));
    }

    function drawFrame() {
      ctx!.clearRect(0, 0, width, height);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.35;
            ctx!.strokeStyle = `rgba(${ACCENT_RGB}, ${alpha})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      for (const n of nodes) {
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${ACCENT_RGB}, 0.85)`;
        ctx!.fill();
      }
    }

    function step() {
      if (!alive) return;
      drawFrame();
      if (!reduceMotion) rafId = requestAnimationFrame(step);
    }

    resize();
    initNodes();
    step(); // hareket azaltma tercih edilse bile en az bir kare çizilir

    const onResize = () => { resize(); };
    window.addEventListener("resize", onResize);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ opacity: 0.6 }}
      aria-hidden="true"
    />
  );
}
