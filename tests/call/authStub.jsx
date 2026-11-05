import { createContext, useContext } from 'react';

const Ctx = createContext({ user: null, profile: null });
export function FakeAuth({ value, children }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() {
  return useContext(Ctx);
}
