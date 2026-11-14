import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../board/Board';
import { QrCode } from '../panels/QrCode';
import { api, ApiError, useSocket } from '../api';
import { playBell, playStone } from '../sound';
import type { Color, RoomChat, RoomView } from '../types';
import '../styles/lan.css';

interface LanViewProps {
  hostName?: string;
  hoverMark?: 'square' | 'ghost';
  onBack?: () => void;
}

const CLIENT_KEY = 'xingyi.clientId';
const ROOM_KEY = 'xingyi.roomCode';

type TimeControlLike = { mainSec: number; byoYomiSec: number; periods: number };

/** 时间制预设（与服务端 server/src/clock.ts 的 TIME_PRESETS 对齐，改一处要改两处） */
const TIME_PRESETS: { id: string; name: string; control: TimeControlLike | null }[] = [
  { id: 'none', name: '不限时', control: null },
  { id: '10m', name: '10 分 + 3×30 秒', control: { mainSec: 600, byoYomiSec: 30, periods: 3 } },
  { id: '5m', name: '5 分 + 3×30 秒', control: { mainSec: 300, byoYomiSec: 30, periods: 3 } },
  { id: 'blitz', name: '3 分包干', control: { mainSec: 180, byoYomiSec: 0, periods: 0 } },
];

const controlName = (c: TimeControlLike | null): string => {
  if (!c) return '不限时';
  const hit = TIME_PRESETS.find(
    (p) =>
      p.control &&
      p.control.mainSec === c.mainSec &&
      p.control.byoYomiSec === c.byoYomiSec &&
      p.control.periods === c.periods,
  );
  if (hit) return hit.name;
  // 不足一分钟的（测试/极速局）直接报秒，别显示成「0 分」
  const main = c.mainSec >= 60 ? `${Math.round(c.mainSec / 60)} 分` : `${c.mainSec} 秒`;
  if (!c.periods) return `${main}包干`;
  return `${main} + ${c.periods}×${c.byoYomiSec} 秒`;
};

const presetIdOf = (c: TimeControlLike | null): string => {
  const hit = TIME_PRESETS.find(
    (p) =>
      (p.control === null && c === null) ||
      (p.control &&
        c &&
        p.control.mainSec === c.mainSec &&
        p.control.byoYomiSec === c.byoYomiSec &&
        p.control.periods === c.periods),
  );
  return hit?.id ?? '10m';
};

const HANDICAP_CHOICES = [0, 2, 3, 4, 5, 6, 7, 8, 9];
const handicapLabel = (n: number): string => (n >= 2 ? `让 ${n} 子` : '不让子');

const fmtClock = (ms: number): string => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
};

function clientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

const STATUS_TEXT: Record<RoomView['status'], string> = {
  waiting: '等人',
  playing: '对局中',
  finished: '已结束',
};

export function LanView({ hostName, hoverMark = 'square', onBack }: LanViewProps) {
  const [name, setName] = useState(() => hostName ?? localStorage.getItem('xingyi.lanName') ?? '棋友');
  const me = useMemo(() => clientId(), []);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [myColor, setMyColor] = useState<Color | 'spectator'>('spectator');
  const [chat, setChat] = useState<RoomChat[]>([]);
  const [code, setCode] = useState('');
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [timePreset, setTimePreset] = useState('10m');
  const [handicap, setHandicap] = useState(0);
  /** 等人阶段房主的待提交设置（以服务端快照为准，改动只是草稿） */
  const [editTime, setEditTime] = useState('10m');
  const [editHandicap, setEditHandicap] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<{ code: string; size: number; host: string; port: number; status?: string }[]>([]);
  // 手谈的二维码必须用局域网 IP：电脑上打开是 127.0.0.1，手机扫了会扫到它自己
  const [lanAddress, setLanAddress] = useState<{ host: string; port: string } | null>(null);
  useEffect(() => {
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
    if (!loopback) {
      setLanAddress({ host: location.hostname, port: location.port });
      return;
    }
    void api
      .netInfo()
      .then((res) => {
        if (res.addresses[0]) setLanAddress({ host: res.addresses[0], port: String(res.port ?? location.port) });
      })
      .catch(() => undefined);
  }, []);
  const joinUrl = useMemo(() => {
    if (!room) return '';
    const host = lanAddress?.host ?? location.hostname;
    const port = lanAddress?.port || location.port;
    return `http://${host}${port && port !== '80' ? ':' + port : ''}/?view=lan&room=${room.code}`;
  }, [room?.code, lanAddress]);
  const inviteRef = useRef<HTMLDetailsElement>(null);
  const roomRef = useRef<RoomView | null>(null);
  roomRef.current = room;

  const apply = (res: { room: RoomView; chat?: RoomChat[] }): void => {
    setRoom(res.room);
    if (res.chat) setChat(res.chat);
    setError(null);
  };

  const fail = (err: unknown, fallback: string): void => {
    setError(err instanceof ApiError ? err.message : fallback);
  };

  // 收发统一走这里：WS 推的、主动拉的，格式一样
  const ingest = useCallback((next: { room: RoomView; chat?: RoomChat[] }, fromWs = false): void => {
    const prev = roomRef.current;
    if (next.room.code !== prev?.code) return;
    const added = next.room.moves.length - (prev?.moves.length ?? 0);
    if (prev && added > 0) playStone(false);
    if (prev && next.room.status === 'finished' && prev.status !== 'finished') playBell();
    roomRef.current = next.room;
    setRoom(next.room);
    if (next.chat) setChat(next.chat);
    if (fromWs) setReconnect(false);
  }, []);

  // 主通道：WS 推送（落子/聊天/悔棋申请都是秒到）
  const { connected } = useSocket((e) => {
    if (e.type !== 'room') return;
    const payload = e.data as { room?: RoomView; chat?: RoomChat[] };
    if (!payload?.room) return;
    ingest({ room: payload.room, chat: payload.chat }, true);
  }, room?.code);

  // WS 刚建立前 connected 也是 false，别在进房间的第一帧闪一条「连接断开」
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (connected) setEverConnected(true);
  }, [connected]);

  // 等人阶段把服务端的设置同步到草稿；进房/开房时各执行一次
  useEffect(() => {
    if (!room || room.status !== 'waiting') return;
    setEditTime(presetIdOf(room.clock?.control ?? null));
    setEditHandicap(room.handicap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.code, room?.status]);

  // 兜底：WS 断了才需要轮询，间隔放宽到 6 秒，别把「推送」做成「轮询换皮」
  useEffect(() => {
    const current = room?.code;
    if (!current || connected) return;
    let fails = 0;
    const timer = window.setInterval(() => {
      void api
        .roomGet(current)
        .then((res) => {
          fails = 0;
          ingest(res);
        })
        .catch(() => {
          // 一次失败可能只是服务重启，连续两次才判定房间没了
          fails += 1;
          if (fails >= 2) {
            setRoom(null);
            localStorage.removeItem(ROOM_KEY);
            setError('房间已经关了（房主离开或超时）');
          }
        });
    }, 6000);
    return () => window.clearInterval(timer);
  }, [room?.code, connected, ingest]);

  // 断线重连：房间码存在本地，重开页面自动回座（服务端认 clientId）
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('room');
    const saved = fromUrl ?? localStorage.getItem(ROOM_KEY);
    if (!saved || roomRef.current) return;
    setReconnect(true);
    api
      .roomJoin(saved, { clientId: me, name })
      .then((res) => {
        setRoom(res.room);
        setMyColor(res.color);
        localStorage.setItem(ROOM_KEY, res.room.code);
        void api.roomGet(saved).then((r) => setChat(r.chat)).catch(() => undefined);
      })
      .catch(() => localStorage.removeItem(ROOM_KEY))
      .finally(() => setReconnect(false));
    // 只在进入界面时试一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const preset = TIME_PRESETS.find((p) => p.id === timePreset) ?? TIME_PRESETS[1];
      const res = await api.roomCreate({
        size,
        komi: 7.5,
        name,
        clientId: me,
        timeControl: preset.control,
        handicap,
      });
      setRoom(res.room);
      setMyColor(res.color);
      setChat([]);
      setError(null);
      localStorage.setItem(ROOM_KEY, res.room.code);
    } catch (err) {
      fail(err, '开房间失败');
    } finally {
      setBusy(false);
    }
  };

  /** 房主在等人阶段提交设置；服务端会再校验一次（非房主/已开局直接拒） */
  const saveSettings = async (): Promise<void> => {
    const current = roomRef.current;
    if (!current) return;
    const preset = TIME_PRESETS.find((p) => p.id === editTime) ?? TIME_PRESETS[1];
    setBusy(true);
    try {
      apply(
        await api.roomSettings(current.code, {
          clientId: me,
          timeControl: preset.control,
          handicap: editHandicap,
        }),
      );
    } catch (err) {
      fail(err, '设置没改成');
    } finally {
      setBusy(false);
    }
  };

  const join = async (target?: string): Promise<void> => {
    const targetCode = (target ?? code).trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(targetCode)) {
      setError('房间码是 6 位字母数字');
      return;
    }
    setBusy(true);
    try {
      const res = await api.roomJoin(targetCode, { name, clientId: me });
      setRoom(res.room);
      setMyColor(res.color);
      setChat([]);
      setError(null);
      localStorage.setItem(ROOM_KEY, res.room.code);
    } catch (err) {
      fail(err, '加入房间失败');
    } finally {
      setBusy(false);
    }
  };

  const discover = async (): Promise<void> => {
    setDiscovering(true);
    setFound([]);
    try {
      const res = await api.roomDiscover();
      setFound(res.rooms);
      if (res.rooms.length === 0) setError('这个网段没找到在等的房间：让对方先「创建房间」，或直接填房间码');
    } catch (err) {
      fail(err, '搜索失败');
    } finally {
      setDiscovering(false);
    }
  };

  const act = useCallback(
    async (action: string, vertex?: number): Promise<void> => {
      const current = roomRef.current;
      if (!current) return;
      try {
        apply(await api.roomAction(current.code, { clientId: me, action, vertex }));
      } catch (err) {
        fail(err, '操作失败');
      }
    },
    [me],
  );

  const sendChat = async (): Promise<void> => {
    const current = roomRef.current;
    const clean = text.trim();
    if (!current || !clean) return;
    setText('');
    try {
      apply(await api.roomSay(current.code, { clientId: me, text: clean }));
    } catch (err) {
      fail(err, '发送失败');
    }
  };

  const leave = async (): Promise<void> => {
    setCopyMessage('');
    localStorage.removeItem(ROOM_KEY);
    const url = new URL(location.href);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    }
    const current = roomRef.current;
    if (current) await act('leave').catch(() => undefined);
    setRoom(null);
    setChat([]);
    setFound([]);
  };

  const myTurn = Boolean(room && room.status === 'playing' && room.toPlay === myColor);
  const isSpectator = myColor === 'spectator';
  const clock = room?.clock ?? null;

  return (
    <div className={room ? 'game screen-game lan-room' : 'lan-lobby'}>
      <div className="board-column">
        <div className="topbar">
          {(onBack || room) && (
            <button className="linkish" onClick={() => void leave().then(onBack)}>
              {onBack ? "← 返回" : "离开房间"}
            </button>
          )}
          <span className="brand">星弈</span>
          <span className="badge">手谈</span>
          {!hostName && !room && (
            <input type="text" className="lan-nickname" aria-label="棋友昵称" maxLength={12} value={name} onChange={(event) => {
              setName(event.target.value);
              localStorage.setItem('xingyi.lanName', event.target.value);
            }} />
          )}
          <span className="grow" />
          {room ? (
            <>
              <span className="badge badge-live">{STATUS_TEXT[room.status]}</span>
              <button
                className="btn"
                onClick={() => {
                  if (inviteRef.current) inviteRef.current.open = true;
                  if (!navigator.clipboard) return;
                  void navigator.clipboard.writeText(joinUrl)
                    .then(() => setCopyMessage('已复制邀请链接'))
                    .catch(() => setCopyMessage('请手动复制下方链接'));
                }}
                title="复制邀请链接"
              >
                房间码 {room.code}
              </button>
            </>
          ) : (
            <span className="badge">局域网</span>
          )}
        </div>

        {room && everConnected && !connected && (
          <div className="lan-banner lan-banner-warn">连接断开，正在重连…（这期间棋盘不会更新）</div>
        )}


        {room && <div className="lan-banner" role="status">
          {isSpectator ? '观战中' : myColor === 'B' ? '你执黑' : '你执白'}
          {room.result ? ` · ${room.result}` : room.status === 'waiting' ? ' · 等对手入座' : myTurn ? ' · 轮到你' : ''}
        </div>}
        {room && error && <div className="notice hint-warn screen-notice" role="alert">{error}</div>}
        {room && clock && (
          <div className="clock-bar">
            {(['B', 'W'] as const).map((c) => {
              const ms = c === 'B' ? clock.blackMs : clock.whiteMs;
              const byo = clock.inByoYomi[c];
              const low = ms <= 20000;
              return (
                <span
                  key={c}
                  className={'clock' + (clock.running === c ? ' is-running' : '') + (low ? ' is-low' : '')}
                >
                  <b>{c === 'B' ? '黑' : '白'}</b>
                  <span className="clock-time">{fmtClock(ms)}</span>
                  {byo && (
                    <span className="clock-byo">
                      读秒 {'●'.repeat(Math.max(0, clock.periods[c]))}
                      {clock.periods[c] === 0 ? '最后' : ''}
                    </span>
                  )}
                </span>
              );
            })}
            <span className="clock-meta">
              {room.status === 'finished' ? '已终局' : clock.running ? '走表中' : '等对手入座'}
            </span>
          </div>
        )}

        {room && <div className="board-wrap">
          <Board
            size={room.size}
            grid={room.grid}
            lastMove={room.lastMove}
            ownership={null}
            showOwnership={false}
            ghost={null}
            hoverMark={hoverMark}
            deadStones={[]}
            interactive={myTurn}
            onPlace={(v) => (myTurn ? void act('move', v) : undefined)}
          />
        </div>}
        {room?.status === 'playing' && !isSpectator && (
          <div className="controls board-actions" role="group" aria-label="房间棋盘操作">
            <button className="btn" onClick={() => void act('pass')} disabled={!myTurn}>停一手</button>
            <button className="btn" onClick={() => void act('undo')} disabled={!room.moves.length || Boolean(room.undoRequest)}>申请悔棋</button>
            <button className="btn" onClick={() => { if (window.confirm('认输这盘？')) void act('resign'); }}>认输</button>
          </div>
        )}
        {room?.undoRequest && !isSpectator && (
          <div className="notice screen-notice" role="status">
            {room.undoRequest.by === myColor ? '悔棋申请已发出，等对方回应。' : '对方申请悔棋。'}
            {room.undoRequest.by !== myColor && <div className="controls">
              <button className="btn btn-primary" onClick={() => void act('undo-yes')}>同意悔棋</button>
              <button className="btn" onClick={() => void act('undo-no')}>拒绝悔棋</button>
            </div>}
          </div>
        )}
      </div>

      <aside className="side">
        {!room ? (
          <div className="lan-lobby-content">
            {error && <div className="notice hint-warn" role="alert">{error}</div>}
            <div className="lan-lobby-grid">
              <section className="panel">
                <h2>加入房间</h2>
                <p className="hint">与棋友连接同一局域网，输入房间码。</p>
                <form className="controls lan-join" onSubmit={(event) => { event.preventDefault(); void join(); }}>
                  <input type="text" aria-label="房间码" value={code} maxLength={6} placeholder="6 位房间码"
                    onChange={(event) => setCode(event.target.value.toUpperCase())} />
                  <button className="btn btn-primary" disabled={busy || !/^[A-Z0-9]{6}$/.test(code.trim())}>加入</button>
                </form>
                <button className="btn" onClick={() => void discover()} disabled={discovering}>
                  {discovering ? '正在搜索…' : '搜索同网段'}
                </button>
                {found.length > 0 && <div className="room-list">
                  {found.map((item) => (
                    <button key={`${item.host}:${item.port}:${item.code}`} className="room-item" disabled={busy}
                      onClick={() => {
                        if (item.host === lanAddress?.host && String(item.port) === lanAddress.port) void join(item.code);
                        else location.assign(`http://${item.host}:${item.port}/?view=lan&room=${item.code}`);
                      }}>
                      <strong>{item.code}</strong><span className="hint">{item.size} 路 · 等人</span>
                    </button>
                  ))}
                </div>}
              </section>
              <section className="panel">
                <h2>创建房间</h2>
                <div className="field">
                  <label htmlFor="lan-size">棋盘</label>
                  <select id="lan-size" value={size} onChange={(event) => setSize(Number(event.target.value) as 9 | 13 | 19)}>
                    <option value={9}>9 路</option><option value={13}>13 路</option><option value={19}>19 路</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="lan-clock">时间制</label>
                  <select id="lan-clock" value={timePreset} onChange={(event) => setTimePreset(event.target.value)}>
                    {TIME_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="lan-handicap">让子</label>
                  <select id="lan-handicap" value={handicap} onChange={(event) => setHandicap(Number(event.target.value))}>
                    {HANDICAP_CHOICES.map((n) => <option key={n} value={n}>{handicapLabel(n)}</option>)}
                  </select>
                </div>
                <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>创建房间</button>
              </section>
            </div>
          </div>
        ) : (
          <>
            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">房间 {room.code}</span>
                <span className="panel-sub">
                  {room.size} 路 · 贴 {room.komi} 目
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-key">时间制</span>
                <span className="stat-val">{controlName(clock?.control ?? null)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-key">让子</span>
                <span className="stat-val">{handicapLabel(room.handicap)}</span>
              </div>
              {room.status === 'waiting' && myColor === 'B' && (
                <div className="lan-settings">
                  <div className="lan-settings-title">开局前可改（只有房主能改）</div>
                  <div className="controls">
                    <select value={editTime} onChange={(e) => setEditTime(e.target.value)}>
                      {TIME_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="controls">
                    <select value={editHandicap} onChange={(e) => setEditHandicap(Number(e.target.value))}>
                      {HANDICAP_CHOICES.map((n) => (
                        <option key={n} value={n}>
                          {handicapLabel(n)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="controls">
                    <button className="btn btn-primary" onClick={() => void saveSettings()} disabled={busy}>
                      应用到房间
                    </button>
                  </div>
                  <div className="hint">改让子会重摆盘面；开下之后这两项锁定。</div>
                </div>
              )}
              {room.status === 'waiting' && myColor !== 'B' && (
                <div className="hint">时间制与让子由房主定。</div>
              )}
              <div className="stat-row">
                <span className="stat-key">你</span>
                <span className="stat-val">
                  {myColor === 'spectator' ? '观众' : myColor === 'B' ? '黑' : '白'}
                  {room.status === 'waiting' ? '（等对手）' : ''}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-key">黑 / 白</span>
                <span className="stat-val">
                  {room.black ?? '空'} / {room.white ?? '空'}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-key">观众</span>
                <span className="stat-val">{room.spectators}</span>
              </div>
              {room.result && <div className="stat-row"><span className="stat-key">结果</span><span className="stat-val">{room.result}</span></div>}
              <details className="screen-details lan-invite" ref={inviteRef} key={room.code}>
                <summary>邀请棋友</summary>
                <div className="qr-block">
                  <QrCode value={joinUrl} size={124} />
                  <div className="hint lan-invite-copy">
                    手机扫这个码直接入座（同一 Wi-Fi）
                    <br />
                    <a href={joinUrl}>{joinUrl}</a>
                    {copyMessage && <div role="status">{copyMessage}</div>}
                  </div>
                </div>
              </details>
            </section>

            <details className="panel screen-details lan-chat">
              <summary>聊天{chat.length > 0 ? ` · ${chat.length} 条` : ''}</summary>
              <div className="chat-list">
                {chat.length === 0 && <div className="hint">说点什么吧。</div>}
                {chat.map((c) => (
                  <div key={c.id} className="chat-line">
                    <span className="chat-name">{c.name}</span>
                    <span>{c.text}</span>
                  </div>
                ))}
              </div>
              <div className="controls">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void sendChat();
                  }}
                  type="text"
                  aria-label="聊天消息"
                  placeholder="说一句…"
                  maxLength={200}
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={() => void sendChat()}>
                  发送
                </button>
              </div>
            </details>
          </>
        )}
      </aside>
    </div>
  );
}
