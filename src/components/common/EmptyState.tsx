import React from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

// PatternFly EmptyState: ortalanmis gri ikon, 16px baslik, aciklama, birincil aksiyon.
export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      {icon && (
        <div className="mb-4 text-[2.25rem] flex justify-center" style={{ color: "var(--text-muted)" }}>
          {icon}
        </div>
      )}
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1rem", fontWeight: 500, color: "var(--text-primary)" }}>
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-md text-[0.875rem]" style={{ color: "var(--text-muted)" }}>{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
