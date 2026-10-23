"use client";

import { createContext, useContext } from "react";

/** What the browser knows about the company whose screens these are. */
export interface ClientBrand {
  name: string;
  slug: string | null;
  primary: string;
  dark: string;
  logoUrl: string | null;
  legalName?: string;
  /** Shown on receipts. Blank parts are left off. */
  contact?: { address: string; phone: string; email: string; website: string };
}

const BrandContext = createContext<ClientBrand>({
  name: "",
  slug: null,
  primary: "#1d4ed8",
  dark: "#0f172a",
  logoUrl: null,
});

export function BrandProvider({ brand, children }: { brand: ClientBrand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): ClientBrand {
  return useContext(BrandContext);
}
