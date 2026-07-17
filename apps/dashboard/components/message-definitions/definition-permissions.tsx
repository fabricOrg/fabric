"use client";

import { createContext, type ReactNode, useContext } from "react";

const DefinitionPermissionsContext = createContext({ canWrite: false });

export function DefinitionPermissionsProvider({
  canWrite,
  children,
}: {
  canWrite: boolean;
  children: ReactNode;
}) {
  return (
    <DefinitionPermissionsContext.Provider value={{ canWrite }}>
      {children}
    </DefinitionPermissionsContext.Provider>
  );
}

export function useDefinitionPermissions() {
  return useContext(DefinitionPermissionsContext);
}
