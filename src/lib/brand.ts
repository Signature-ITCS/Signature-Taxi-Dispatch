/**
 * The business this dispatch is white-labelled for — one place for the name,
 * colours and logo files, so every screen, email and SMS says the same thing.
 */
export const BRAND = {
  name: "Signature Transfers",
  legalName: "Signature Transfers",
  /** Staff-side app name (installed dispatch / admin app). */
  staffAppName: "Signature Dispatch",
  /** Driver app name (installed driver PWA). */
  driverAppName: "Signature Driver",
  /** SMS sender IDs are at most 11 letters/digits, no spaces or symbols. */
  smsSender: "Signature",
  colors: {
    orange: "#b07d12", // main colour (buttons, accents)
    navy: "#121820", // dark colour (text, headers)
    steel: "#4e5d6c", // muted text
  },
  /** Text wordmark as an image. Screens and emails show the name as text instead. */
  logo: "/brand/logo.png",
  /** "ST" lettermark, square — also the source of the app icons. */
  logoMark: "/brand/mark.png",
} as const;
