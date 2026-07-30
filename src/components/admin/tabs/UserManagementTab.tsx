// src/components/admin/tabs/UserManagementTab.tsx
import React, { useEffect, useState } from "react";
import { roleApi } from "@/api/adminApi";
import { useToast } from "@/hooks/useToast";
import { PencilSquareIcon, TrashIcon, PlusIcon, ShieldCheckIcon, UserIcon } from "@heroicons/react/24/outline";
import { Select } from "@/components/ui/Form";

type RoleMap = Record<string, string>;

export default function UserManagementTab() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleMap>({});
  const [loading, setLoading] = useState(true);
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState<"Admin" | "User">("Admin");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    roleApi.list().then(setRoles).catch(() => toast.error("Roller yüklenemedi.")).finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    const u = addUser.trim().toLowerCase();
    if (!u) return;
    setSaving(true);
    try {
      const { sessionsRevoked } = await roleApi.set(u, addRole);
      setRoles((r) => ({ ...r, [u]: addRole }));
      setAddUser("");
      toast.success(`${u} kullanıcısına ${addRole} rolü atandı.` + (sessionsRevoked > 0 ? ` ${sessionsRevoked} aktif oturum sonlandırıldı.` : ""));
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleChange(username: string, role: "Admin" | "User") {
    try {
      const { sessionsRevoked } = await roleApi.set(username, role);
      setRoles((r) => ({ ...r, [username]: role }));
      toast.success(`${username}: ${role}` + (sessionsRevoked > 0 ? ` — ${sessionsRevoked} aktif oturum sonlandırıldı.` : ""));
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function handleRemove(username: string) {
    try {
      const { sessionsRevoked } = await roleApi.remove(username);
      setRoles((r) => { const n = { ...r }; delete n[username]; return n; });
      toast.success(`${username} rolü sıfırlandı (LDAP/varsayılan geçerli).` + (sessionsRevoked > 0 ? ` ${sessionsRevoked} aktif oturum sonlandırıldı.` : ""));
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  const entries = Object.entries(roles).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Kullanıcı Rol Yönetimi</h3>
        <p className="text-xs text-gray-500">
          Belirli LDAP kullanıcılarına manuel rol atayın. LDAP grup üyeliğinden bağımsız, her login'de geçerlidir.
          Override silinince kullanıcı LDAP grubuna döner.
        </p>
      </div>

      {/* Add new override */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Kullanıcı adı (sAMAccountName)</label>
          <input
            type="text"
            value={addUser}
            onChange={(e) => setAddUser(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="ahmet.yilmaz"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
          <Select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as "Admin" | "User")}
          >
            <option value="Admin">Admin</option>
            <option value="User">User</option>
          </Select>
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !addUser.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          Ekle
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-gray-400 text-center py-8">Yükleniyor…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <UserIcon className="h-8 w-8 mx-auto mb-2 text-gray-200" />
          <p className="text-sm">Henüz manuel rol ataması yok.</p>
          <p className="text-xs mt-1">Kullanıcılar LDAP grup üyeliklerine göre rol alır.</p>
        </div>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Kullanıcı</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Manuel Rol</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(([username, role]) => (
                <tr key={username} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{username}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      role === "Admin"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {role === "Admin"
                        ? <ShieldCheckIcon className="h-3 w-3" />
                        : <UserIcon className="h-3 w-3" />}
                      {role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleChange(username, role === "Admin" ? "User" : "Admin")}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title={`${role === "Admin" ? "User" : "Admin"} yap`}
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleRemove(username)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Override'ı kaldır (LDAP'a dön)"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-amber-600">
        Not: Bir rol değiştirildiğinde veya kaldırıldığında, o kullanıcının TÜM aktif oturumları
        anında sonlandırılır — bir sonraki isteğinde oturumu düşer, yeniden giriş yapması gerekir
        (yeni rolle).
      </p>
    </div>
  );
}
