import {
  AirVent,
  Bug,
  Car,
  GraduationCap,
  Hammer,
  Paintbrush,
  Scissors,
  Smartphone,
  Sparkles,
  Truck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Category icon registry — maps the `icon` string stored in the DB
 * to a lucide component. Keeps DB data decoupled from component code.
 */
const ICON_REGISTRY: Record<string, LucideIcon> = {
  AirVent,
  Bug,
  Car,
  GraduationCap,
  Hammer,
  Paintbrush,
  Scissors,
  Smartphone,
  Sparkles,
  Truck,
  Wrench,
  Zap,
};

export function getCategoryIcon(icon?: string | null): LucideIcon {
  if (icon && icon in ICON_REGISTRY) return ICON_REGISTRY[icon];
  return Sparkles; // safe default
}
