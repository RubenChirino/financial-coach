import type { DB } from "./client";
import { categories } from "./schema";

export const DEFAULT_CATEGORIES = [
  {
    slug: "groceries",
    nameEs: "Supermercado",
    nameEn: "Groceries",
    icon: "ShoppingCart",
    color: "#22c55e",
  },
  {
    slug: "dining",
    nameEs: "Restaurantes",
    nameEn: "Dining out",
    icon: "UtensilsCrossed",
    color: "#f97316",
  },
  {
    slug: "coffee",
    nameEs: "Café y bares",
    nameEn: "Coffee & bars",
    icon: "Coffee",
    color: "#d97706",
  },
  { slug: "transport", nameEs: "Transporte", nameEn: "Transport", icon: "Bus", color: "#3b82f6" },
  { slug: "fuel", nameEs: "Combustible", nameEn: "Fuel", icon: "Fuel", color: "#1d4ed8" },
  { slug: "housing", nameEs: "Vivienda", nameEn: "Housing", icon: "Home", color: "#0ea5e9" },
  { slug: "utilities", nameEs: "Suministros", nameEn: "Utilities", icon: "Plug", color: "#06b6d4" },
  {
    slug: "telecom",
    nameEs: "Móvil e internet",
    nameEn: "Telecom",
    icon: "Wifi",
    color: "#0891b2",
  },
  {
    slug: "subscriptions",
    nameEs: "Suscripciones",
    nameEn: "Subscriptions",
    icon: "Repeat",
    color: "#8b5cf6",
  },
  {
    slug: "entertainment",
    nameEs: "Ocio",
    nameEn: "Entertainment",
    icon: "Film",
    color: "#a855f7",
  },
  {
    slug: "shopping",
    nameEs: "Compras",
    nameEn: "Shopping",
    icon: "ShoppingBag",
    color: "#ec4899",
  },
  { slug: "health", nameEs: "Salud", nameEn: "Health", icon: "HeartPulse", color: "#ef4444" },
  { slug: "pharmacy", nameEs: "Farmacia", nameEn: "Pharmacy", icon: "Pill", color: "#dc2626" },
  {
    slug: "fitness",
    nameEs: "Deporte y gimnasio",
    nameEn: "Fitness",
    icon: "Dumbbell",
    color: "#14b8a6",
  },
  {
    slug: "education",
    nameEs: "Educación",
    nameEn: "Education",
    icon: "GraduationCap",
    color: "#6366f1",
  },
  { slug: "travel", nameEs: "Viajes", nameEn: "Travel", icon: "Plane", color: "#7c3aed" },
  { slug: "kids", nameEs: "Hijos", nameEn: "Kids", icon: "Baby", color: "#f472b6" },
  { slug: "pets", nameEs: "Mascotas", nameEn: "Pets", icon: "PawPrint", color: "#a3a3a3" },
  { slug: "gifts", nameEs: "Regalos", nameEn: "Gifts", icon: "Gift", color: "#e11d48" },
  { slug: "taxes", nameEs: "Impuestos", nameEn: "Taxes", icon: "Scale", color: "#64748b" },
  { slug: "insurance", nameEs: "Seguros", nameEn: "Insurance", icon: "Shield", color: "#475569" },
  {
    slug: "fees",
    nameEs: "Comisiones bancarias",
    nameEn: "Bank fees",
    icon: "Receipt",
    color: "#78716c",
  },
  {
    slug: "income",
    nameEs: "Ingresos",
    nameEn: "Income",
    icon: "ArrowDownToLine",
    color: "#10b981",
  },
  {
    slug: "transfers",
    nameEs: "Transferencias",
    nameEn: "Transfers",
    icon: "ArrowLeftRight",
    color: "#94a3b8",
  },
  { slug: "other", nameEs: "Otros", nameEn: "Other", icon: "MoreHorizontal", color: "#737373" },
] as const;

export async function seedDefaultCategories(db: DB): Promise<void> {
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i]!;
    await db
      .insert(categories)
      .values({ ...c, isSystem: true, sortOrder: i })
      .onConflictDoNothing({ target: categories.slug });
  }
}
