import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../board/Board';
import { api, ApiError, type Bootstrap } from '../api';
import { playStone } from '../sound';
import type { Color, RoomChat, RoomView } from '../types';

interface LanViewProps {
  bootstrap: Bootstrap;
  onBack: () => void;
}

const CLIENT_KEY = 'xingyi.clientId';

function clientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID().slice(0, 12);
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

const STATUS_TEXT: Record<RoomView['status'], string> = {
  waiting: '等人',
  playing: '对局中',
  finished: '已结束',
};

export function LanView({ bootstrap, onBack }: LanViewProps) {
  const me = useMemo(() => clientId(), []);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [myColor, setMyColor] = useState<Color | 'spectator'>('spectator');
  const [chat, setChat] = useState<RoomChat[]>([]);
  const [code, setCode] = useState('');
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<{ code: string; size: number; host: string; port: number; status?: string }[]>([]);
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

  // 轮询房间状态（1.2s）：手谈只传落子与聊天，不值得上复杂协议
  useEffect(() => {
    const current = room?.code;
    if (!current) return;
    const timer = window.setInterval(() => {
      void api
        .roomGet(current)
        .then((res) => {
          const prev = roomRef.current;
          const added = res.room.moves.length - (prev?.moves.length ?? 0);
          if (prev && added > 0) playStone(false);
          setRoom(res.room);
          setChat(res.chat);
        })
        .catch(() => {
          setRoom(null);
          setError('房间已经关了（房主离开或超时）');
        });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [room?.code]);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.roomCreate({ size, komi: 7.5, name: bootstrap.progress.playerName, clientId: me });
      setRoom(res.room);
      setMyColor(res.color);
      setChat([]);
      setError(null);
    } catch (err) {
      fail(err, '开房间失败');
    } finally {
      setBusy(false);
    }
  };

  const join = async (target?: string): Promise<void> => {
    const targetCode = (target ?? code).trim().toUpperCase();
    if (targetCode.length < 4) {
      setError('房间码是 6 位字母数字');
      return;
    }
    setBusy(true);
    try {
      const res = await api.roomJoin(targetCode, { name: bootstrap.progress.playerName, clientId: me });
      setRoom(res.room);
      setMyColor(res.color);
      setChat([]);
      setError(null);
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
    const current = roomRef.current;
    if (current) await act('leave').catch(() => undefined);
    setRoom(null);
    setChat([]);
    setFound([]);
  };

  const myTurn = Boolean(room && room.status === 'playing' && room.toPlay === myColor);
  const boardSize = room?.size ?? size;

  return (
    <div className="game">
      <div className="board-column">
        <div className="topbar">
          <button className="linkish" onClick={() => void leave().then(onBack)}>
            ← 返回
          </button>
          <span className="brand">星弈</span>
          <span className="badge">手谈</span>
          <span className="grow" />
          {room ? (
            <>
              <span className="badge badge-live">{STATUS_TEXT[room.status]}</span>
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${location.origin} 房间码 ${room.code}`);
                  setError(null);
                }}
                title="复制地址与房间码，发给同网段的朋友"
              >
                房间码 {room.code}
              </button>
            </>
          ) : (
            <span className="badge">局域网</span>
          )}
        </div>

        <div className="board-wrap">
          <Board
            size={boardSize}
            grid={room?.grid ?? new Array(boardSize * boardSize).fill(0)}
            lastMove={room?.lastMove ?? null}
            ownership={null}
            showOwnership={false}
            ghost={null}
            hoverMark={bootstrap.config.ui.hoverMark}
            deadStones={[]}
            interactive={myTurn}
            onPlace={(v) => (myTurn ? void act('move', v) : undefined)}
          />
        </div>
      </div>

      <aside className="side">
        {!room ? (
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">手谈</span>
              <span className="panel-sub">同一局域网 · 不计入进度</span>
            </div>
            <div className="field">
              <label>开一间（你执黑）</label>
              <div className="controls">
                <select value={size} onChange={(e) => setSize(Number(e.target.value) as 9 | 13 | 19)}>
                  <option value={9}>9 路</option>
                  <option value={13}>13 路</option>
                  <option value={19}>19 路</option>
                </select>
                <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
                  创建房间
                </button>
              </div>
            </div>
            <div className="field">
              <label>加入（房间码）</label>
              <div className="controls">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="6 位房间码"
                  maxLength={6}
                  style={{ width: 130, letterSpacing: '.2em' }}
                />
                <button className="btn" onClick={() => void join()} disabled={busy}>
                  加入
                </button>
              </div>
            </div>
            <div className="field">
              <label>自动发现</label>
              <button className="btn" onClick={() => void discover()} disabled={discovering}>
                {discovering ? '正在听同网段的房间…' : '搜索同网段'}
              </button>
              {found.length > 0 && (
                <div className="room-list">
                  {found.map((r) => (
                    <button key={`${r.host}:${r.code}`} className="room-item" onClick={() => void join(r.code)}>
                      <span>{r.code}</span>
                      <span className="hint">
                        {r.size} 路 · {r.status === 'waiting' ? '等人' : '对局中'} · {r.host}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {error && <div className="notice hint-warn">{error}</div>}
            <div className="hint">
              手机/平板：连同一个 Wi-Fi，浏览器打开电脑这一页（地址见设置），用房间码加入。
              手谈不提供 AI 推荐，也不计入修习进度。
            </div>
          </section>
        ) : (
          <>
            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">房间 {room.code}</span>
                <span className="panel-sub">{room.size} 路 · 贴 {room.komi} 目</span>
              </div>
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
              <div className="controls" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => void act('pass')} disabled={!myTurn}>
                  停一手
                </button>
                <button
                  className="btn"
                  onClick={() => void act('undo')}
                  disabled={!myColor || myColor === 'spectator' || room.moves.length === 0 || Boolean(room.undoRequest)}
                  title="悔棋要对方同意"
                >
                  申请悔棋
                </button>
                <button className="btn" onClick={() => void act('resign')} disabled={!myColor || myColor === 'spectator' || room.status !== 'playing'}>
                  认输
                </button>
                <button className="btn" onClick={() => void leave()}>
                  退出房间
                </button>
              </div>
              {room.undoRequest && (
                <div className="notice">
                  {room.undoRequest.by === myColor ? '悔棋申请已发出，等对方回应。' : '对方申请悔棋：'}
                  {room.undoRequest.by !== myColor && (
                    <div className="controls" style={{ marginTop: 6 }}>
                      <button className="btn btn-primary" onClick={() => void act('undo-yes')}>
                        同意
                      </button>
                      <button className="btn" onClick={() => void act('undo-no')}>
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
              )}
              {error && <div className="notice hint-warn">{error}</div>}
            </section>

            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">聊天</span>
                <span className="panel-sub">不入库</span>
              </div>
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
                  placeholder="说一句…"
                  maxLength={200}
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={() => void sendChat()}>
                  发送
                </button>
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
