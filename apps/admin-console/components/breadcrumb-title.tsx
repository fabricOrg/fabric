"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Lets a dynamic-route page (e.g. /tenants/[slug]) set the breadcrumb leaf to a real name the URL
 * can't carry. The layout renders the breadcrumb from the pathname; a page drops in
 * <SetBreadcrumbTitle title={…} /> to override the leaf while mounted, clearing it on unmount.
 */
interface BreadcrumbTitleValue {
  title: string | null;
  setTitle: (title: string | null) => void;
}

const BreadcrumbTitleContext = createContext<BreadcrumbTitleValue>({
  title: null,
  setTitle: () => {},
});

export function BreadcrumbTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <BreadcrumbTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </BreadcrumbTitleContext.Provider>
  );
}

export function useBreadcrumbTitle(): BreadcrumbTitleValue {
  return useContext(BreadcrumbTitleContext);
}

export function SetBreadcrumbTitle({ title }: { title: string }) {
  const { setTitle } = useBreadcrumbTitle();
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
  return null;
}
