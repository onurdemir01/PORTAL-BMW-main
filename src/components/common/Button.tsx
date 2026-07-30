import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  icon?: React.ReactNode;
  loading?: boolean;
}

// PatternFly Button varyantlari:
//   primary   → dolu mavi (#06c)
//   secondary → mavi cerceveli, seffaf zemin
//   danger    → dolu kirmizi (#c9190b)
//   ghost     → PF "link" butonu (cercevesiz, mavi metin)
const SIZE_CLASSES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "text-[0.875rem] px-3 py-1",
  md: "text-[0.875rem] px-4 py-1.5",
};

export default function Button({
  variant = "secondary", size = "md", icon, loading, disabled, className = "", children, ...rest
}: ButtonProps) {
  if (variant === "ghost") {
    return (
      <button
        disabled={disabled || loading}
        className={`pf-btn-link disabled:opacity-50 ${SIZE_CLASSES[size]} ${className}`}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  }
  const variantClass = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-secondary";
  return (
    <button disabled={disabled || loading} className={`${variantClass} ${SIZE_CLASSES[size]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}
