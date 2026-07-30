import React from "react";

interface Props {
  allColumns: string[];
  visible: string[];
  onChange: (cols: string[]) => void;
  onClose: () => void;
}

const ColumnPicker: React.FC<Props> = ({ allColumns, visible, onChange, onClose }) => {
  function toggle(col: string) {
    if (visible.includes(col)) {
      if (visible.length === 1) return;
      onChange(visible.filter((c) => c !== col));
    } else {
      onChange([...visible, col].sort((a, b) => allColumns.indexOf(a) - allColumns.indexOf(b)));
    }
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl shadow-lg border border-gray-100 p-3 min-w-[220px] max-h-80 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600">Sütun Seçimi</span>
        <div className="flex gap-2 text-xs text-blue-600">
          <button onClick={() => onChange(allColumns)} className="hover:underline">
            Tümü
          </button>
          <button
            onClick={() => onChange(allColumns.slice(0, 1))}
            className="hover:underline text-gray-400"
          >
            Temizle
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        {allColumns.map((col) => (
          <label
            key={col}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700"
          >
            <input
              type="checkbox"
              checked={visible.includes(col)}
              onChange={() => toggle(col)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
            />
            {col}
          </label>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
        <button
          onClick={onClose}
          className="text-xs px-3 py-1 bg-black text-white rounded-lg hover:bg-gray-800"
        >
          Kapat
        </button>
      </div>
    </div>
  );
};

export default ColumnPicker;
