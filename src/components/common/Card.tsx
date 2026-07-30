import React from "react";

interface CardProps {
  as?: "div" | "button";
  hoverable?: boolean;
  /** none = duz yuzey, sm = px-4 py-3 (satir), md = p-6 (PF Card ic bosluğu) */
  padding?: "none" | "sm" | "md";
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const PADDING_CLASSES: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "px-4 py-3",
  md: "p-6",
};

// PatternFly Card: beyaz yuzey, 3px kose, yumusak golge, kenarlik yok.
// Props ve sinif adlari DEGISMEDI — yalniz gorunum PF'ye tasindi.
export default function Card({ as = "div", hoverable = false, padding = "md", className = "", onClick, style, children }: CardProps) {
  const base = padding === "md"
    ? `card ${hoverable ? "card-hover" : ""} p-6`
    : `card ${hoverable ? "card-hover" : ""} ${PADDING_CLASSES[padding]}`;
  const cls = `${base} ${className}`.trim();
  if (as === "button") {
    return (
      <button onClick={onClick} className={`${cls} text-left w-full`} style={style}>
        {children}
      </button>
    );
  }
  return (
    <div onClick={onClick} className={cls} style={style}>
      {children}
    </div>
  );
}
