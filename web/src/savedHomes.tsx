import { createContext, useContext, type ReactNode } from 'react';
import { useSavedHomes, type SavedHomesState } from './hooks/useSavedHomes';

const SavedHomesContext = createContext<SavedHomesState | null>(null);

export function SavedHomesProvider({ children }: { children: ReactNode }) {
  const value = useSavedHomes();
  return <SavedHomesContext.Provider value={value}>{children}</SavedHomesContext.Provider>;
}

export function useSavedHomesContext(): SavedHomesState {
  const ctx = useContext(SavedHomesContext);
  if (!ctx) throw new Error('useSavedHomesContext requires SavedHomesProvider');
  return ctx;
}
