import {
  ArrowDownToLine,
  ArrowLeftRight,
  Baby,
  Bus,
  Coffee,
  Dumbbell,
  Film,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  MoreHorizontal,
  PawPrint,
  Pill,
  Plane,
  Plug,
  Receipt,
  Repeat,
  Scale,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";
import type { ComponentType } from "react";

/** Maps every icon slug used in seed-categories.ts to its Lucide component. */
const ICON_MAP: Record<string, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  ShoppingCart,
  Smartphone,
  UtensilsCrossed,
  Coffee,
  Bus,
  Fuel,
  Home,
  Plug,
  Wifi,
  Repeat,
  Film,
  ShoppingBag,
  HeartPulse,
  Pill,
  Dumbbell,
  GraduationCap,
  Plane,
  Baby,
  PawPrint,
  Gift,
  Scale,
  Shield,
  Receipt,
  ArrowDownToLine,
  ArrowLeftRight,
  MoreHorizontal,
};

/**
 * Renders a category icon.
 *
 * If the stored `icon` value is a known Lucide icon name (e.g. "ShoppingCart"),
 * the matching Lucide component is rendered at the given size. If it looks
 * like an emoji or unknown name, it falls back to plain text so legacy /
 * user-defined icons still display.
 */
export function CategoryIcon({
  icon,
  className,
  strokeWidth = 2,
}: {
  icon: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Comp = ICON_MAP[icon];
  if (Comp) {
    return <Comp className={className ?? "h-4 w-4"} strokeWidth={strokeWidth} />;
  }
  // Fallback: emoji or custom text
  return <span aria-hidden>{icon}</span>;
}
