import React from "react";

interface Props {
  content: string;
  children: React.ReactElement;
  position?: "top" | "bottom" | "left" | "right";
}

const POS_MAP = {
  top:    "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left:   "right-full top-1/2 -translate-y-1/2 mr-2",
  right:  "left-full top-1/2 -translate-y-1/2 ml-2",
};

export function Tooltip({ content, children, position = "top" }: Props) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span
        className={`pointer-events-none absolute ${POS_MAP[position]} z-50 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150`}
      >
        {content}
      </span>
    </span>
  );
}
