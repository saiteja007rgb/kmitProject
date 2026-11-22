import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authApi } from '../api/endpoints';
import { registerSessionExpiredHandler, setAccessToken } from '../api/httpClient';
import { Spinner } from '../components/ui';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [sessionNotice, setSessionNotice] = useState(null);

  useEffect(() => {
    registerSessionExpiredHandler((reason) => {
      setUser(null);
      setSessionNotice(reason || 'Session ended. Please sign in again.');
    });

    let cancelled = false;
    authApi
      .refresh()
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username, password) => {
    const data = await authApi.login(username, password);
    setAccessToken(data.access_token);
    setSessionNotice(null);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore network errors during sign-out.
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const freshUser = await authApi.getMe();
    setUser(freshUser);
    return freshUser;
  }, []);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  return (
    <AuthContext.Provider
      value={{ user, initializing, sessionNotice, clearSessionNotice, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function RequireRole({ allowedRoles, children }) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'candidate' ? '/candidate' : '/admin'} replace />;
  }

  return children;
}
