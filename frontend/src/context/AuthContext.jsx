import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('exampulse_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('exampulse_token');
    if (token) {
      authAPI.getMe()
        .then((profile) => {
          setUser(profile);
          localStorage.setItem('exampulse_user', JSON.stringify(profile));
        })
        .catch(() => {
          logout();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const data = await authAPI.login(username, password);
    localStorage.setItem('exampulse_token', data.access_token);
    const profile = {
      id: data.user_id,
      username: username,
      role: data.role,
      candidate_id: data.candidate_id,
      display_name: data.display_name,
    };
    setUser(profile);
    localStorage.setItem('exampulse_user', JSON.stringify(profile));
    return profile;
  };

  const logout = () => {
    localStorage.removeItem('exampulse_token');
    localStorage.removeItem('exampulse_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

