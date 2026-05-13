"use client";

import { createContext, useContext } from "react";

interface SidebarCtx {
  /** True when the desktop sidebar is in icon-only (collapsed) mode. */
  collapsed: boolean;
}

export const SidebarContext = createContext<SidebarCtx>({ collapsed: false });

export function useSidebar(): SidebarCtx {
  return useContext(SidebarContext);
}
