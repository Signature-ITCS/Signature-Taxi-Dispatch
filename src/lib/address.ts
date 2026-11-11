/**
 * Door / flat numbers.
 *
 * Staff can type a door, flat or building the map address doesn't include. It
 * is saved in front of the address — "Flat 2, 12 High Street, Sheerness" — so
 * drivers, receipts and texts see it with no extra column.
 *
 * splitDoor takes it back out (for the Door / flat no. box when a booking is
 * edited or reused from the customer's history). It only takes a first part
 * that looks like a door/flat/unit — "Flat 2", "No. 14", "14", "12B", "Unit 5",
 * "Apartment 3B" — never the start of a real street like "12 High Street".
 */

const DOOR_RE = /^(flat|apartment|apt|unit|room|suite|block|floor|house|door|no\.?|number|building|bldg)\b|^\d+[a-z]?$|^[a-z]?\d+[a-z]?$/i;

export function splitDoor(full: string): { door: string; address: string } {
  const i = full.indexOf(",");
  if (i <= 0) return { door: "", address: full };
  const first = full.slice(0, i).trim();
  return first.length <= 30 && DOOR_RE.test(first) ? { door: first, address: full.slice(i + 1).trim() } : { door: "", address: full };
}

export function withDoor(door: string | undefined, address: string): string {
  const d = (door ?? "").trim().replace(/,+$/, "");
  return d && !address.toLowerCase().startsWith(d.toLowerCase()) ? `${d}, ${address}` : address;
}
