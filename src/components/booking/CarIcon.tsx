import { Car, CarFront, Bus, type LucideIcon } from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  car: Car,
  "car-front": CarFront,
  bus: Bus,
};

export function carIcon(name: string | null | undefined): LucideIcon {
  return MAP[name || "car"] || Car;
}
