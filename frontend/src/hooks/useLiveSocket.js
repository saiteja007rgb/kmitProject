/** Authenticated WebSocket hook with automatic token refresh on 4401, keepalive pings, and backoff reconnect. */
import { useEffect, useRef, useState } from 'react';
import {
  getAccessToken,
  getActiveWebSocketOrigin,
  refreshAccessTokenSingleFlight,
} from '../api/httpClient';

export function useLiveSocket(path, onMessage, enabled = true) {
  const [status, setStatus] = useState('disconnected'); // connected | reconnecting | disconnected
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled || !path) {
      setStatus('disconnected');
      return undefined;
    }

    let socket = null;
    let pingTimer = null;
    let reconnectTimer = null;
    let attempt = 0;
    let closedByCleanup = false;

    async function connect() {
      if (closedByCleanup) return;
      let token = getAccessToken();
      if (!token) {
        try {
          const refreshed = await refreshAccessTokenSingleFlight();
          token = refreshed.access_token;
        } catch {
          setStatus('disconnected');
          return;
        }
      }

      const separator = path.includes('?') ? '&' : '?';
      const url = `${getActiveWebSocketOrigin()}${path}${separator}token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        setStatus('connected');
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send('ping');
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const parsed = JSON.parse(event.data);
          onMessageRef.current?.(parsed);
        } catch {
          // Ignore malformed frames.
        }
      };

      socket.onclose = async (closeEvent) => {
        window.clearInterval(pingTimer);
        if (closedByCleanup) return;
        if (closeEvent.code === 4403) {
          setStatus('disconnected');
          return;
        }
        setStatus('reconnecting');
        if (closeEvent.code === 4401) {
          try {
            await refreshAccessTokenSingleFlight();
          } catch {
            setStatus('disconnected');
            return;
          }
        }
        const delayMs = Math.min(15000, 1000 * 2 ** Math.min(attempt, 4));
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delayMs);
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      closedByCleanup = true;
      window.clearInterval(pingTimer);
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [path, enabled]);

  return status;
}
