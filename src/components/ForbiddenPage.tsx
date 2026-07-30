import React from "react";
import { Link } from "react-router-dom";

export default function ForbiddenPage() {
  return (
    <div className="bg-white p-8 rounded-xl shadow-sm max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">403 - Yetkisiz Erişim</h1>
      <p className="mt-2 text-gray-600">
        Bu sayfaya erişim yetkiniz yok. Eğer erişim talebiniz varsa lütfen admin ile iletişime geçin.
      </p>

      <div className="mt-6 flex gap-3">
        <Link
          to="/dashboard"
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          Dashboard’a Dön
        </Link>

        <Link
          to="/important-links"
          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
        >
          Önemli Linkler
        </Link>
      </div>
    </div>
  );
}