import dgram from 'node:dgram';

/** 局域网发现端口（UDP）。只广播房间摘要，不传棋谱。 */
export const DISCOVERY_PORT = 7389;

export interface DiscoveredRoom {
  code: string;
  size: number;
  host: string;
  port: number;
  status?: string;
}

/**
 * 有房间时每 2 秒广播一次；没有房间就不发，避免在别人机器上刷出空列表。
 * 返回停止函数。
 */
export function startBeacon(getRooms: () => { code: string; size: number; status: string }[]): () => void {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => undefined);
  sock.bind(() => {
    try {
      sock.setBroadcast(true);
    } catch {
      /* 某些网络环境不允许广播，忽略 */
    }
  });
  const timer = setInterval(() => {
    const rooms = getRooms();
    if (rooms.length === 0) return;
    const payload = Buffer.from(
      JSON.stringify({
        type: 'xingyi-room',
        port: Number(process.env.XINGYI_PORT ?? process.env.PORT ?? 7388),
        rooms,
      }),
    );
    try {
      sock.send(payload, DISCOVERY_PORT, '255.255.255.255');
    } catch {
      /* 广播失败不致命 */
    }
  }, 2000);
  return () => {
    clearInterval(timer);
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  };
}

/** 听 1.2 秒，收集同网段在等对手的房间。 */
export function discoverRooms(timeoutMs = 1200): Promise<DiscoveredRoom[]> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map<string, DiscoveredRoom>();
    sock.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString()) as {
          rooms?: { code: string; size: number; status?: string }[];
          port?: number;
        };
        for (const r of data.rooms ?? []) {
          found.set(`${rinfo.address}:${data.port ?? 7388}:${r.code}`, {
            code: r.code,
            size: r.size,
            host: rinfo.address,
            port: data.port ?? 7388,
            status: r.status,
          });
        }
      } catch {
        /* 不是我们的包 */
      }
    });
    sock.on('error', () => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve([...found.values()]);
    });
    sock.bind(DISCOVERY_PORT, () => {
      setTimeout(() => {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        resolve([...found.values()]);
      }, timeoutMs);
    });
  });
}
