import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as authApi from "../api/auth";

export const AuthContext = createContext(null);

export default function AuthContextProvider({ children }) {
  const [user, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userVersion = useRef(0);

  const setUser = useCallback((nextUser) => {
    userVersion.current += 1;
    setCurrentUser(nextUser);
  }, []);

  useEffect(() => {
    const versionAtStart = userVersion.current;
    const applyIfNotStale = (nextUser) => {
      if (userVersion.current === versionAtStart) setCurrentUser(nextUser);
    };

    authApi
      .me()
      .then((res) => applyIfNotStale(res.user))
      .catch(() => applyIfNotStale(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (email, password) => {
      const res = await authApi.login(email, password);
      setUser(res.user);
      return res.user;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, [setUser]);

  const value = useMemo(
    () => ({ user, loading, login, logout, setUser }),
    [user, loading, login, logout, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
