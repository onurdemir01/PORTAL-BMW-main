// bmw-portal-project-management-dashboard/types.ts

export interface User {
  username: string;
  role: "Admin" | "User";
  displayName?: string;
  mail?: string;
  photoUrl?: string | null;
  authSource?: string;
}

export type SelfServiceSample = {
  type: "link" | "text";
  value: string;
};

export interface SelfServiceItem {
  id: string;
  title: string;
  order: number;

  // required indexes
  tabId: string;
  subTabId: string;

  info?: string;
  goUrl: string; // required
  requestExample: string; // required
  details?: string;
  sample: SelfServiceSample; // required
  extra?: string;
}

export interface SelfServiceSubTab {
  id: string;
  name: string;
  order: number;
  items: SelfServiceItem[];
}

export interface SelfServiceTab {
  id: string;
  name: string;
  order: number;
  section?: "smart" | "others";
  subTabs: SelfServiceSubTab[];
}

export interface SelfServiceStore {
  version: number;
  tabs: SelfServiceTab[];
}
