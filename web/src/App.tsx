import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Bootstrap, type SocketEvent } from './api';
import { GameView } from './modes/GameView';
import { LanPlaceholder, Menu } from './modes/Menu';
import { Settings } from './Settings';
import { setSoundEnabled } from './sound';
import { SKINS, cssVars, skinById } from './theme/skins';
import type { EngineStatus, Mode, ProgressView } from './types';

type View = 'menu' | 'free' | 'ranked' | 'lan' | 'settings';

const THEME_KEY = 'xingyi.theme';

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>('menu');
  const [themeId, setThemeId] = useState<string>(() => localStorage.getItem(THEME_KEY) ?? 'walnut');
  const [lastEvent, setLastEvent] = useState<SocketEvent | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const skin = skinById(themeId);
  const vars = useMemo(() => cssVars(skin.tokens), [skin]);

  const showToast = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const load = useCallback(async () => {
    try {
      const b = await api.bootstrap();
      setBoot(b);
      setFatal(null);
      setSoundEnabled(b.config.ui.sound);
      if (!localStorage.getItem(THEME_KEY) && b.config.ui.themeId) setThemeId(b.config.ui.themeId);
    } catch {
      setFatal('连不上本地服务。请确认 `npm run dev` 的 server 那一半在跑（默认 7388 端口）。');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // WS：引擎状态、对局推送、进度更新
  const onSocket = useCallback(
    (e: SocketEvent) => {
      setLastEvent(e);
      if (e.type === 'engine') {
        setBoot((b) => (b ? { ...b, engine: e.data as EngineStatus } : b));
      } else if (e.type === 'progress') {
        setBoot((b) => (b ? { ...b, progress: e.data as ProgressView } : b));
      }
    },
    [],
  );

  // WebSocket 单独起（App 层只订阅，不阻塞渲染）
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: number | undefined;
    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = (ev) => {
        try {
          onSocket(JSON.parse(ev.data as string) as SocketEvent);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!closed) timer = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, [onSocket]);

  const changeTheme = useCallback(
    (id: string) => {
      if (id === themeId) return;
      const previous = themeId;
      setThemeId(id);
      localStorage.setItem(THEME_KEY, id);
      void api.saveConfig({ ui: { ...(boot?.config.ui ?? {}), themeId: id } }).catch(() => undefined);
      showToast(`已切换到「${skinById(id).name}」`, () => {
        setThemeId(previous);
        localStorage.setItem(THEME_KEY, previous);
        void api.saveConfig({ ui: { ...(boot?.config.ui ?? {}), themeId: previous } }).catch(() => undefined);
        setToast(null);
      });
    },
    [boot?.config.ui, showToast, themeId],
  );

  const enter = (mode: Mode) => {
    if (mode === 'lan') setView('lan');
    else setView(mode);
  };

  const backToMenu = async () => {
    setView('menu');
    await load();
  };

  if (fatal) {
    return (
      <div className="app-shell" style={vars as React.CSSProperties}>
        <div className="menu">
          <div className="menu-inner">
            <h1 className="menu-title" style={{ fontSize: 48 }}>
              星弈
            </h1>
            <div className="gold-line menu-rule" />
            <div className="notice hint-warn" style={{ marginTop: 26 }}>
              {fatal}
            </div>
            <div className="menu-foot">
              <button className="linkish" onClick={() => void load()}>
                重试
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!boot) {
    return (
      <div className="app-shell" style={vars as React.CSSProperties}>
        <div className="menu">
          <div className="menu-inner">
            <div className="menu-title">星弈</div>
            <div className="hint">正在连本地服务…</div>
          </div>
        </div>
      </div>
    );
  }

  const engineReady = boot.engine.state === 'ready';

  return (
    <div
      className="app-shell"
      style={vars as React.CSSProperties}
      data-decor={skin.tokens.decor.join(' ')}
      data-variant-button={skin.variants.button}
      data-variant-panel={skin.variants.panel}
      data-variant-result={skin.variants.result}
    >
      {view === 'menu' && (
        <Menu
          progress={boot.progress}
          engineReady={engineReady}
          onSelect={enter}
          onSettings={() => setView('settings')}
        />
      )}

      {(view === 'free' || view === 'ranked') && (
        <GameView
          key={view}
          mode={view}
          bootstrap={boot}
          lastEvent={lastEvent}
          onBack={() => void backToMenu()}
        />
      )}

      {view === 'lan' && <LanPlaceholder onBack={() => setView('menu')} />}

      {view === 'settings' && (
        <Settings
          bootstrap={boot}
          themeId={themeId}
          onTheme={changeTheme}
          onBack={() => setView('menu')}
          onBootstrap={(b) => {
            setBoot(b);
            setSoundEnabled(b.config.ui.sound);
          }}
        />
      )}

      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo}>撤销</button>}
        </div>
      )}

      {!engineReady && view !== 'settings' && (
        <div
          className="stage-note"
          style={{ position: 'fixed', right: 14, bottom: 10, padding: 0, fontSize: 11, opacity: 0.7 }}
        >
          引擎未就绪 · 可用离线对手 · 当前主题：{SKINS.find((s) => s.id === themeId)?.name}
        </div>
      )}
    </div>
  );
}
