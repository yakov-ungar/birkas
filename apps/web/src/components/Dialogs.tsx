import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface DialogApi {
  /** Replaces the current dialog (the demo moves between cards the same way). */
  open: (node: ReactNode) => void;
  close: () => void;
}

const Ctx = createContext<DialogApi>({ open: () => {}, close: () => {} });

export function DialogProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [key, setKey] = useState(0);
  const open = useCallback((n: ReactNode) => {
    setNode(n);
    setKey((k) => k + 1);
  }, []);
  const close = useCallback(() => setNode(null), []);
  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      <div key={key}>{node}</div>
    </Ctx.Provider>
  );
}

export const useDialogs = () => useContext(Ctx);
