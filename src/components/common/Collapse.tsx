import React from "react";

interface CollapseProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

// CSS grid-template-rows trick: 0fr ↔ 1fr with transition gives smooth height animation
// without needing JS height measurement.
const Collapse: React.FC<CollapseProps> = ({ open, children, className = "" }) => (
  <div
    className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${className}`}
    style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
  >
    <div className="overflow-hidden">{children}</div>
  </div>
);

export default Collapse;
