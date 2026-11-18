import { getApiBaseUrl, getAuthToken } from './api';

export interface WsSubscribeOptions {
  room: string;
  onMessage: (data: any) => void;
}

export function subscribeRealtimeRoom({ room, onMessage }: WsSubscribeOptions): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closed) return;
    const token = getAuthToken();
    if (!token) return;
    const apiBase = getApiBaseUrl();
    let url: string;
    if (apiBase) {
      const parsed = new URL(apiBase);
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${proto}//${parsed.host}/ws`;
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${proto}//${window.location.host}/ws`;
    }
    ws = new WebSocket(url);

    ws.onopen = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          room,
          token,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data));
        if (parsed?.type === 'auth_error') {
          closed = true;
          ws?.close();
          return;
        }
        onMessage(parsed);
      } catch {
        // ignore invalid frames
      }
    };

    ws.onclose = (ev) => {
      if (ev.code === 4001 || ev.code === 4003) {
        closed = true;
        return;
      }
      if (!closed) {
        reconnectTimer = window.setTimeout(connect, 2500);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  };
}

export function buildGoogleMapsDirectionsUrl(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`;
}
