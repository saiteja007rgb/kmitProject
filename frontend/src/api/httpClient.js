/**
 * Shared Axios HTTP client:
 * - Access token kept strictly in JS memory (never localStorage)
 * - Refresh token travels in an httpOnly cookie via `withCredentials: true`
 * - Single-flight silent refresh on HTTP 401
 * - Automatic failover to Backend 2 (port 8002) if Backend 1 drops mid-exam
 */
import axios from 'axios';

let activeBaseUrl = '/api';
const FAILOVER_BASE_URL = 'http://127.0.0.1:8002/api';

let inMemoryAccessToken = null;
let refreshPromise = null;
let sessionExpiredHandler = null;

export function getAccessToken() {
  return inMemoryAccessToken;
}

export function setAccessToken(token) {
  inMemoryAccessToken = token || null;
}

export function registerSessionExpiredHandler(handler) {
  sessionExpiredHandler = handler;
}

export function getActiveWebSocketOrigin() {
  if (activeBaseUrl.startsWith('http')) {
    return activeBaseUrl.replace(/^http/, 'ws').replace(/\/api$/, '');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export const httpClient = axios.create({
  baseURL: activeBaseUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

httpClient.interceptors.request.use((config) => {
  config.baseURL = activeBaseUrl;
  if (inMemoryAccessToken) {
    config.headers.Authorization = `Bearer ${inMemoryAccessToken}`;
  }
  return config;
});

export async function refreshAccessTokenSingleFlight() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${activeBaseUrl}/auth/refresh`, null, { withCredentials: true })
      .then((response) => {
        setAccessToken(response.data.access_token);
        return response.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (!originalRequest) return Promise.reject(error);

    // Instance failover: if Backend 1 dies mid-exam, switch transparently to Backend 2.
    const isInstanceDown = !error.response || [502, 503, 504].includes(error.response.status);
    if (isInstanceDown && !originalRequest._retriedFailover && activeBaseUrl !== FAILOVER_BASE_URL) {
      originalRequest._retriedFailover = true;
      activeBaseUrl = FAILOVER_BASE_URL;
      originalRequest.baseURL = FAILOVER_BASE_URL;
      return httpClient(originalRequest);
    }

    const requestUrl = originalRequest.url || '';
    const isAuthEndpoint = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/refresh');
    const detail = String(error.response?.data?.detail || '');

    if (error.response?.status === 401 && !isAuthEndpoint) {
      // Single-device eviction must sign out immediately rather than refreshing.
      if (detail.toLowerCase().includes('another device')) {
        setAccessToken(null);
        sessionExpiredHandler?.(detail);
        return Promise.reject(error);
      }

      if (!originalRequest._retriedRefresh) {
        originalRequest._retriedRefresh = true;
        try {
          await refreshAccessTokenSingleFlight();
          originalRequest.headers.Authorization = `Bearer ${inMemoryAccessToken}`;
          return httpClient(originalRequest);
        } catch (refreshError) {
          setAccessToken(null);
          const refreshDetail = refreshError?.response?.data?.detail || 'Your session expired. Please sign in again.';
          sessionExpiredHandler?.(refreshDetail);
          return Promise.reject(error);
        }
      }
    }

    return Promise.reject(error);
  }
);
