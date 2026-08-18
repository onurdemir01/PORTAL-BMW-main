// bmw-portal-project-management-dashboard/types.ts

export interface User {
  username: string;
  role: "Admin" | "User";
  displayName?: string;
  mail?: string;
  photoUrl?: string | null;
  authSource?: string;
}

