import { useEffect, useState } from 'react';
import { SaveManager } from './SaveManager';
import type { CSSProperties } from 'react';
import { api, ApiError, type Bootstrap } from './api';
import { SOUND_PACKS, configureSound, previewPack } from './sound';
import { SKINS, cssVars, type Skin } from './theme/skins';
import { exportThemeUrl, importThemeFile, syncThemes } from './theme/packs';
import type { AppConfigLike } from './types';

const SETTINGS_SECTIONS = [
  ['engine', '引擎'], ['appearance', '界面'], ['sound', '音效'], ['saves', '存档'], ['about', '关于'],
] as const;
type SettingsSection = typeof SETTINGS_SECTIONS[number][0];

interface SettingsProps {
  bootstrap: Bootstrap;
  themeId: string;
  initialSection?: 'saves' | null;
  onTheme: (id: string) => void;
  onBack: () => void;
  onBootstrap: (b: Bootstrap) => void;
}

function ThemePreview({ skin }: { skin: Skin }) {
  const t = skin.tokens;
  const style = {
    ...(cssVars(t) as CSSProperties),
    background: t.color.bg,
    color: t.color.text,
    fontFamily: t.font.title,
    ['--pv-dim']: t.color.textDim,
    ['--pv-board']: t.color.board,
    ['--pv-edge']: t.color.boardEdge,
    ['--pv-black']: t.color.blackStone,
    ['--pv-white']: t.color.whiteStone,
    // 预览里的棋子也用真棋盘的四个停点，否则深色主题的黑子在预览里等于隐形
    ['--pv-bhi']: t.color.blackStoneHighlight,
    ['--pv-bedge']: t.color.blackStoneEdge,
    ['--pv-whi']: t.color.whiteStoneHighlight,
    ['--pv-wedge']: t.color.whiteStoneEdge,
    ['--pv-radius']: `${t.radius.md}px`,
  } as CSSProperties;
  const cells = [
    '',
    'b',
    '',
    'w',
    '',
    '',
    'b',
    'w',
    '',
    'b',
    'w',
    '',
    '',
    'b',
    '',
    '',
    'w',
    '',
    'b',
    '',
    'b',
    '',
    'w',
    '',
    'w',
  ];
  return (
    <div className="theme-preview" style={style}>
      <div className="pv-title">星弈</div>
      <div className="pv-row">
        <span>修习</span>
        <span>自在</span>
        <span>手谈</span>
      </div>
      <div className="pv-board">
        {cells.map((c, i) => (
          <span key={i} className={`pv-cell${c ? ` ${c}` : ''}`} />
        ))}
      </div>
    </div>
  );
}

export function Settings({ bootstrap, themeId, initialSection, onTheme, onBack, onBootstrap }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'engine');
  const [engine, setEngine] = useState<AppConfigLike['engine']>(bootstrap.config.engine);
  const [ui, setUi] = useState<AppConfigLike['ui']>(bootstrap.config.ui);
  const [name, setName] = useState(bootstrap.progress.playerName);
  const [hardware, setHardware] = useState<string[] | null>(null);
  const [check, setCheck] = useState<{ label: string; ok: boolean; message: string }[] | null>(null);
  const [engineState, setEngineState] = useState(bootstrap.engine);
  const [busy, setBusy] = useState<string | null>(null);
  const [install, setInstall] = useState<Awaited<ReturnType<typeof api.engineInstallStatus>> | null>(null);
  const [installError, setInstallError] = useState('');
  const installing = install?.phase === 'detecting' || install?.phase === 'downloading' || install?.phase === 'checking';
  const [msg, setMsg] = useState<string | null>(null);
  const [sim, setSim] = useState<Awaited<ReturnType<typeof api.simulateRanked>> | null>(null);
  // 主题面板：列表用本地状态（SKINS 是可变数组，导入后要触发一次渲染）
  const [skins, setSkins] = useState<Skin[]>(SKINS);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeMsg, setThemeMsg] = useState<string | null>(null);
  const [themeWarn, setThemeWarn] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    syncThemes()
      .then((list) => {
        if (alive) setSkins(list);
      })
      .catch(() => {
        /* 服务端没起来就继续用本地缓存，导入按钮会给出中文错误 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const onImportTheme = async (file: File | null): Promise<void> => {
    if (!file) return;
    setThemeBusy(true);
    setThemeMsg(null);
    setThemeWarn([]);
    try {
      const { skin, warnings } = await importThemeFile(file);
      setSkins([...SKINS]);
      onTheme(skin.id);
      setThemeMsg(`已导入「${skin.name}」并应用`);
      setThemeWarn(warnings);
    } catch (err) {
      setThemeMsg(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '导入失败');
    } finally {
      setThemeBusy(false);
    }
  };

  useEffect(() => {
    setEngineState(bootstrap.engine);
    setEngine(bootstrap.config.engine);
    setUi(bootstrap.config.ui);
  }, [bootstrap]);

  useEffect(() => { setName(bootstrap.progress.playerName); }, [bootstrap.progress.playerName, bootstrap.progress.activeSaveId]);

  const refresh = async () => {
    try {
      onBootstrap(await api.bootstrap());
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await api.engineInstallStatus();
        if (!active) return;
        setInstall(status);
        if (status.phase === 'ready') {
          const updated = await api.bootstrap();
          if (active) onBootstrap(updated);
        }
        if (['detecting', 'downloading', 'checking'].includes(status.phase)) timer = window.setTimeout(() => void poll(), 1000);
      } catch {
        if (active) timer = window.setTimeout(() => void poll(), 2000);
      }
    };
    if (section === 'engine') void poll();
    return () => { active = false; window.clearTimeout(timer); };
  // 新的安装任务会恢复轮询。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, installing]);

  const installKataGo = async () => {
    setBusy('install');
    setInstallError('');
    try {
      setInstall(await api.installEngine());
    } catch (error) {
      setInstallError(error instanceof ApiError ? error.message : '无法开始安装，请重试。');
    } finally {
      setBusy(null);
    }
  };

  const save = async (patch: Partial<AppConfigLike>) => {
    try {
      const res = await api.saveConfig(patch);
      setMsg('已保存');
      window.setTimeout(() => setMsg(null), 2000);
      await refresh();
      return res.config;
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : '保存失败');
      return null;
    }
  };

  const probe = async () => {
    setBusy('probe');
    setHardware(null);
    try {
      const hw = await api.probe();
      setHardware([
        `系统：${hw.os}`,
        `CPU：${hw.cpu}`,
        `显卡：${hw.gpus.length ? hw.gpus.join(' / ') : '未检测到'}`,
        `显存：${hw.vramMb ? `${Math.round(hw.vramMb)} MB` : '未知'}`,
        `推荐后端：${hw.recommended.toUpperCase()} —— ${hw.reason}`,
        ...hw.warnings.map((w) => `注意：${w}`),
      ]);
      setEngine((e) => ({ ...e, backend: hw.recommended }));
    } catch {
      setHardware(['探测失败。可以直接手动选择后端。']);
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async () => {
    setBusy('check');
    setCheck(null);
    await save({ engine });
    try {
      const res = await api.check();
      setCheck(res.steps);
      if (res.ok) setMsg(`引擎就绪${res.version ? ` · v${res.version}` : ''}`);
    } catch (err) {
      setCheck([{ label: '自检', ok: false, message: err instanceof ApiError ? err.message : '自检失败' }]);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const restart = async () => {
    setBusy('restart');
    try {
      await api.restartEngine();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const backendLabels: Record<string, string> = {
    cuda: 'CUDA（NVIDIA 显卡，最快）',
    directml: 'DirectML（兼容 DirectX 12 显卡）',
    opencl: 'OpenCL（任意显卡 / 核显）',
    eigen: 'Eigen（纯 CPU，极慢）',
  };

  return (
    <div className="settings settings-screen">
      <div className="settings-inner">
        <div className="settings-toolbar">
          <button className="linkish" onClick={onBack}>
            ← 返回
          </button>
          <h2>设置</h2>
          <span style={{ flex: 1 }} />
          {msg && <span className="hint" role="status">{msg}</span>}
        </div>

        <nav className="screen-tabs settings-nav" aria-label="设置分类">
          {SETTINGS_SECTIONS.map(([id, label]) => (
            <button key={id} className="btn" aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>

        <section className="panel" hidden={section !== 'engine'}>
          <div className="panel-head">
            <span className="panel-title">引擎</span>
            <span className="panel-sub">
              {['ready', 'thinking', 'analyzing'].includes(engineState.state)
                ? `就绪 · ${engineState.version ?? '已连接'}`
                : engineState.state === 'crashed'
                  ? '启动失败'
                  : engineState.state === 'starting'
                    ? '加载中'
                    : '未配置'}
            </span>
          </div>
          {engineState.error && <div className="notice hint-warn" style={{ marginBottom: 12 }}>{engineState.error}</div>}

          {install?.supported && (
            <div className="notice">
              <button className="btn btn-primary" onClick={() => void installKataGo()} disabled={Boolean(busy) || installing
                || (['ready', 'thinking', 'analyzing'].includes(engineState.state) && Boolean(engineState.humanModelPath))}>
                {installing ? '正在安装 KataGo…' : install.phase === 'ready' ? 'KataGo 已安装' : '一键安装 KataGo'}
              </button>
              {install.phase !== 'ready' && <p className="hint">首次约需下载 200–220 MB。星弈会选择适合本机的版本，安装主模型和人类棋风模型。</p>}
              {install.message && <p className={install.phase === 'failed' ? 'hint-warn' : 'hint'} role="status">{install.message}</p>}
              {installError && <p className="hint-warn" role="alert">{installError}</p>}
            </div>
          )}
          <div className="stat-row"><span className="stat-key">后端</span><strong>{backendLabels[engine.backend]}</strong></div>
          <div className="stat-row"><span className="stat-key">模型</span><span>{engine.modelPath && engine.humanModelPath ? '已填写主模型与人类模型' : '请填写主模型和人类模型'}</span></div>
          <details className="screen-details settings-paths" open={!bootstrap.config.engine.binaryPath || !bootstrap.config.engine.modelPath || !bootstrap.config.engine.humanModelPath || undefined}>
            <summary>程序、模型路径与后端</summary>
            <div className="field">
              <label htmlFor="engine-binary">katago 程序</label>
              <input id="engine-binary"
                type="text"
                value={engine.binaryPath ?? ''}
                placeholder="例如 D:\\katago\\katago.exe（Windows）或 /usr/local/bin/katago"
                onChange={(e) => setEngine({ ...engine, binaryPath: e.target.value || null })}
              />
            </div>
            <div className="field">
              <label htmlFor="engine-main">主模型</label>
              <input id="engine-main"
                type="text"
                value={engine.modelPath ?? ''}
                placeholder="b18c384nbt-*.bin.gz 的完整路径"
                onChange={(e) => setEngine({ ...engine, modelPath: e.target.value || null })}
              />
            </div>
            <div className="field">
              <label htmlFor="engine-human">human SL 模型</label>
              <input id="engine-human"
                type="text"
                value={engine.humanModelPath ?? ''}
                placeholder="b18c384nbt-humanv0.bin.gz（修习必需）"
                onChange={(e) => setEngine({ ...engine, humanModelPath: e.target.value || null })}
              />
            </div>
            <div className="field">
              <label htmlFor="engine-config">配置文件</label>
              <input id="engine-config"
                type="text"
                value={engine.configPath ?? ''}
                placeholder="gtp_xingyi_cuda.cfg（可留空，用默认参数启动）"
                onChange={(e) => setEngine({ ...engine, configPath: e.target.value || null })}
              />
            </div>
            <div className="field">
              <label htmlFor="engine-backend">后端</label>
              <select id="engine-backend" value={engine.backend} onChange={(e) => setEngine({ ...engine, backend: e.target.value as 'cuda' })}>
                {Object.entries(backendLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </details>

          <div className="controls" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void probe()} disabled={Boolean(busy) || installing}>
              {busy === 'probe' ? '探测中…' : '探测硬件'}
            </button>
            <button className="btn btn-primary" onClick={() => void runCheck()} disabled={Boolean(busy) || installing}>
              {busy === 'check' ? '自检中…' : '保存并自检'}
            </button>
            <button className="btn" onClick={() => void restart()} disabled={Boolean(busy) || installing}>
              重启引擎
            </button>
          </div>

          {hardware && (
            <div className="steps" style={{ marginTop: 14 }}>
              {hardware.map((line) => (
                <div className="step" key={line}>
                  <span className="dot" style={{ background: 'var(--accent)' }} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}

          {check && (
            <div className="steps" style={{ marginTop: 14 }}>
              {check.map((s) => (
                <div className={`step ${s.ok ? 'ok' : 'bad'}`} key={s.label}>
                  <span className="dot" />
                  <span>
                    {s.label}：{s.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="hint" style={{ marginTop: 14 }}>
            已有 KataGo 可在上方手动指定。安装说明见 <code>docs/引擎安装.md</code>。
          </div>
        </section>

        <section className="panel" hidden={section !== 'appearance'}>
          <div className="panel-head">
            <span className="panel-title">主题</span>
            <span className="panel-sub">选中即预览，应用后 5 秒内可撤销</span>
          </div>
          <div className="theme-grid">
            {skins.map((skin) => (
              <button
                key={skin.id}
                className={`theme-card${skin.id === themeId ? ' is-active' : ''}`}
                onClick={() => onTheme(skin.id)}
              >
                <ThemePreview skin={skin} />
                <div className="theme-meta">
                  <div className="name">
                    {skin.name}
                    <span className="hint" style={{ marginLeft: 8 }}>
                      {skin.tagline}
                    </span>
                  </div>
                  <div className="desc">{skin.description}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="controls" style={{ marginTop: 12 }}>
            <label
              className="btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: themeBusy ? 0.6 : 1,
                cursor: themeBusy ? 'progress' : 'pointer',
              }}
            >
              {themeBusy ? '导入中…' : '导入主题包（zip）'}
              <input
                type="file"
                accept=".zip,application/zip"
                style={{ display: 'none' }}
                disabled={themeBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = ''; // 允许重复选同一个文件
                  void onImportTheme(file);
                }}
              />
            </label>
            <a className="btn" href={exportThemeUrl(themeId)} download>
              导出当前主题
            </a>
          </div>
          {themeMsg && (
            <div className="hint" style={{ marginTop: 8 }}>
              {themeMsg}
            </div>
          )}
          {themeWarn.length > 0 && (
            <div className="notice hint-warn" style={{ marginTop: 8, lineHeight: 1.8 }}>
              {themeWarn.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            主题包里只允许 <code>theme.json</code> 与 <code>assets/</code> 下的 png/jpg/webp 图片；
            带 CSS 或 JS 的包会被直接拒绝，程序不执行主题里的任何代码。导入后立刻出现在上面。
          </div>

          <div className="field">
            <label htmlFor="settings-hover">落子虚影</label>
            <select id="settings-hover"
              value={ui.hoverMark}
              onChange={(e) => {
                const v = e.target.value as 'square' | 'ghost';
                setUi({ ...ui, hoverMark: v });
                void save({ ui: { ...ui, hoverMark: v } });
              }}
            >
              <option value="square">小方块（默认，换主题都看得清）</option>
              <option value="ghost">棋子虚影（拟真，浅色盘上偏淡）</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="settings-analysis">分析深度</label>
            <select id="settings-analysis"
              value={ui.analysisDepth}
              onChange={(e) => {
                const v = e.target.value as 'quick' | 'standard' | 'deep';
                setUi({ ...ui, analysisDepth: v });
                void save({ ui: { ...ui, analysisDepth: v } });
              }}
            >
              <option value="quick">快速（约 0.3 秒）</option>
              <option value="standard">标准（约 0.5~1.5 秒）</option>
              <option value="deep">深算（数秒）</option>
            </select>
          </div>
        </section>

        <section className="panel" hidden={section !== 'sound'}>
          <div className="panel-head"><span className="panel-title">音效</span></div>
          <div className="field">
            <label htmlFor="settings-sound">落子音效</label>
            <select id="settings-sound"
              value={ui.sound ? 'on' : 'off'}
              onChange={(e) => {
                const on = e.target.value === 'on';
                setUi({ ...ui, sound: on });
                configureSound({ enabled: on });
                void save({ ui: { ...ui, sound: on } });
              }}
            >
              <option value="on">开（落子、提子、终局磬）</option>
              <option value="off">关</option>
            </select>
          </div>
          <div className="field">
            <label>音色</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {SOUND_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  className={`btn${ui.soundPack === pack.id ? ' btn-primary' : ''}`}
                  onClick={() => {
                    setUi({ ...ui, soundPack: pack.id });
                    configureSound({ enabled: true, pack: pack.id });
                    previewPack(pack.id);
                    void save({ ui: { ...ui, soundPack: pack.id } });
                  }}
                  title={pack.hint}
                >
                  {pack.name}
                </button>
              ))}
              <button className="btn" onClick={() => previewPack(ui.soundPack)}>
                试听
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="settings-volume">音量</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                id="settings-volume"
                type="range"
                min={0}
                max={100}
                value={Math.round(ui.soundVolume * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  setUi({ ...ui, soundVolume: v });
                  configureSound({ volume: v });
                }}
                onPointerUp={(e) => {
                  const v = Number((e.target as HTMLInputElement).value) / 100;
                  void save({ ui: { ...ui, soundVolume: v } });
                }}
                onKeyUp={(event) => {
                  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                    void save({ ui: { ...ui, soundVolume: Number(event.currentTarget.value) / 100 } });
                  }
                }}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span className="hint" style={{ minWidth: 34, textAlign: 'right' }}>
                {Math.round(ui.soundVolume * 100)}
              </span>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {SOUND_PACKS.find((p) => p.id === ui.soundPack)?.hint ?? ''}
            　· 音效全部由程序现场合成（零版权素材），不用下载音频文件。
          </div>
        </section>

        <div className="settings-section-stack" hidden={section !== 'saves'}>
          <SaveManager onChange={refresh} />
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">当前存档名称</span>
            </div>
            <div className="field">
              <label htmlFor="settings-player-name">当前名称</label>
              <input type="text" id="settings-player-name" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="controls" style={{ marginTop: 8 }}>
              <button
                className="btn"
                disabled={!bootstrap.progress.activeSaveId}
                onClick={async () => {
                  try {
                    await api.rename(name);
                    await refresh();
                    setMsg('已改名');
                  } catch (err) {
                    setMsg(err instanceof ApiError ? err.message : '改名失败');
                  }
                }}
              >
                保存名字
              </button>
            </div>
          </section>
        </div>

        <div className="settings-section-stack" hidden={section !== 'about'}>
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">关于</span>
              <span className="panel-sub">v{bootstrap.version}</span>
            </div>
            <div className="hint" style={{ lineHeight: 2 }}>
              星弈 · 开源围棋修炼软件（MIT）。规则只做中国规则：数子、贴 7.5 目。
              <br />
              二十五级为新手起点，一级最强。一级以职业初段为校准目标，仍需真人对局验证。
              <br />
              {bootstrap.ranks.calibrated
                ? `等级校准分已实测${bootstrap.ranks.step ? `（中位步长 ${bootstrap.ranks.step} 分/级）` : ''}。`
                : '⚠️ 等级校准分尚未实测（ranks.json 为占位值），升降级幅度待校准。'}
              {bootstrap.ranks.note ? (
                <>
                  <br />
                  <span style={{ opacity: 0.75 }}>{bootstrap.ranks.note}</span>
                </>
              ) : null}
            </div>
          </section>

          <details className="panel screen-details">
            <summary>评级沙盘</summary>
            <div className="hint">
              从当前等级模拟 12 盘胜负，查看升降级变化。
            </div>
            <div className="controls" style={{ marginTop: 10 }}>
              {(
                [
                  ['win', '连赢 12 盘'],
                  ['alternate', '胜负交替'],
                  ['lose', '连败 12 盘'],
                ] as const
              ).map(([pattern, label]) => (
                <button
                  key={pattern}
                  className="btn"
                  onClick={async () => {
                    try {
                      setSim(await api.simulateRanked(pattern, 12));
                    } catch {
                      setMsg('沙盘跑不动（服务端出错）');
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {sim && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <div className="hint">
                  起点 {sim.start.level} 级 · R {sim.start.R} → 终点 {sim.end.levelCn} · R {sim.end.R}（RD {sim.end.RD}）
                </div>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))', gap: 6 }}>
                  {sim.timeline.map((g) => (
                    <div
                      key={g.game}
                      title={`第 ${g.game} 盘 · R ${g.R}`}
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 7px',
                        background: 'var(--surface-alt)',
                      }}
                    >
                      <div style={{ color: g.won ? 'var(--ok)' : 'var(--danger)' }}>{g.won ? '胜' : '负'}</div>
                      <div className="hint" style={{ fontSize: 11 }}>
                        {g.deltaR > 0 ? '+' : ''}
                        {g.deltaR} · {g.level} 级
                        {g.change === 'up' ? ' ↑' : g.change === 'down' ? ' ↓' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </details>
        </div>
      </div>
    </div>
  );
}
