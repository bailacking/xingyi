import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Bootstrap, type SocketEvent } from './api';
import { GameView } from './modes/GameView';
import { Menu } from './modes/Menu';
import { LanView } from './modes/LanView';
import { LearnView } from './modes/LearnView';
import { Settings } from './Settings';
import { configureSound } from './sound';
import { DEFAULT_SKIN_ID, SKINS, cssVars, skinById } from './theme/skins';
import type { EngineStatus, Mode, ProgressView } from './types';

type View = 'menu' | 'free' | 'ranked' | 'lan' | 'learn' | 'settings';

const THEME_KEY = 'xingyi.theme';
const VIEWS: View[] = ['menu', 'free', 'ranked', 'lan', 'learn', 'settings'];

/** 支持 ?view=free&theme=xuanmo 直接进某个界面（截图与调试用，不影响正常使用） */
function initialView(): View {
  const v = new URLSearchParams(location.search).get('view');
  return v && VIEWS.includes(v as View) ? (v as View) : 'menu';
}

/**
 * 启动时的主题：?theme= > localStorage > 默认（素雪）。
 * 旧版本存过 walnut / youth / bamboo，这些 id 已经不存在了 → 清掉，回落到默认浅色。
 */
function initialTheme(): string {
  const q = new URLSearchParams(location.search).get('theme');
  if (q && SKINS.some((s) => s.id === q)) return q;
  const stored = localStorage.getItem(THEME_KEY);
  if (stored && SKINS.some((s) => s.id === stored)) return stored;
  if (stored) localStorage.removeItem(THEME_KEY);
  return DEFAULT_SKIN_ID;
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [themeId, setThemeId] = useState<string>(initialTheme);
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
      configureSound({ enabled: b.config.ui.sound, pack: b.config.ui.soundPack, volume: b.config.ui.soundVolume });
      const fromQuery = new URLSearchParams(location.search).get('theme');
      // config 里可能是旧主题 id（walnut / youth / bamboo），认不出就留在默认主题上
      if (!fromQuery && !localStorage.getItem(THEME_KEY) && SKINS.some((s) => s.id === b.config.ui.themeId)) {
        setThemeId(b.config.ui.themeId);
      }
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
          onLearn={() => setView('learn')}
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

      {view === 'lan' && <LanView bootstrap={boot!} onBack={() => setView('menu')} />}
      {view === 'learn' && <LearnView bootstrap={boot!} onBack={() => setView('menu')} />}

      {view === 'settings' && (
        <Settings
          bootstrap={boot}
          themeId={themeId}
          onTheme={changeTheme}
          onBack={() => setView('menu')}
          onBootstrap={(b) => {
            setBoot(b);
            configureSound({ enabled: b.config.ui.sound, pack: b.config.ui.soundPack, volume: b.config.ui.soundVolume });
          }}
        />
      )}

      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo}>撤销</button>}
        </div>
      )}
    </div>
  );
}
