/**
 * The business this dispatch is white-labelled for — one place for the name,
 * colours and logo files, so every screen, email and SMS says the same thing.
 */
export const BRAND = {
  name: "Cheap Transfers",
  legalName: "Cheap Transfers",
  /** Staff-side app name (installed dispatch / admin app). */
  staffAppName: "Cheap Transfers Dispatch",
  /** Driver app name (installed driver PWA). */
  driverAppName: "Cheap Transfers Driver",
  /** SMS sender IDs are at most 11 letters/digits, no spaces or symbols. */
  smsSender: "CheapTrans",
  /** Shown on receipts. A blank line is left off the receipt. */
  contact: {
    address: "",
    phone: "",
    email: "",
    website: "",
  },
  colors: {
    orange: "#1d4ed8", // "24/7 TAXI LTD" in the logo
    navy: "#0f172a", // logo outline
    steel: "#4e5d6c", // "CHEAP TRANSFERS" in the logo
  },
  /** Full wordmark (mark + "CHEAP TRANSFERS"), for light backgrounds. */
  logo: "/brand/logo.png",
  /** The logo mark on its own, transparent background. */
  logoMark: "/brand/mark.png",
} as const;
