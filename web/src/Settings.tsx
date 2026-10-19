import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, ApiError, type Bootstrap } from './api';
import { SOUND_PACKS, configureSound, previewPack } from './sound';
import { SKINS, cssVars, type Skin } from './theme/skins';
import { exportThemeUrl, importThemeFile, syncThemes } from './theme/packs';
import type { AppConfigLike } from './types';

interface SettingsProps {
  bootstrap: Bootstrap;
  themeId: string;
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

export function Settings({ bootstrap, themeId, onTheme, onBack, onBootstrap }: SettingsProps) {
  const [engine, setEngine] = useState<AppConfigLike['engine']>(bootstrap.config.engine);
  const [ui, setUi] = useState<AppConfigLike['ui']>(bootstrap.config.ui);
  const [name, setName] = useState(bootstrap.progress.playerName);
  const [hardware, setHardware] = useState<string[] | null>(null);
  const [check, setCheck] = useState<{ label: string; ok: boolean; message: string }[] | null>(null);
  const [engineState, setEngineState] = useState(bootstrap.engine);
  const [busy, setBusy] = useState<string | null>(null);
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

  const refresh = async () => {
    try {
      onBootstrap(await api.bootstrap());
    } catch {
      /* 忽略 */
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
    opencl: 'OpenCL（任意显卡 / 核显）',
    eigen: 'Eigen（纯 CPU，极慢）',
  };

  return (
    <div className="settings">
      <div className="settings-inner">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <button className="linkish" onClick={onBack}>
            ← 返回
          </button>
          <h2>设置</h2>
          <span style={{ flex: 1 }} />
          {msg && <span className="hint">{msg}</span>}
        </div>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">引擎</span>
            <span className="panel-sub">
              {engineState.state === 'ready'
                ? `就绪 · ${engineState.version ?? '已连接'}`
                : engineState.state === 'crashed'
                  ? '启动失败'
                  : engineState.state === 'starting'
                    ? '加载中'
                    : '未配置'}
            </span>
          </div>
          {engineState.error && <div className="notice hint-warn" style={{ marginBottom: 12 }}>{engineState.error}</div>}

          <div className="field">
            <label>katago 程序</label>
            <input
              type="text"
              value={engine.binaryPath ?? ''}
              placeholder="例如 D:\\katago\\katago.exe（Windows）或 /usr/local/bin/katago"
              onChange={(e) => setEngine({ ...engine, binaryPath: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>主模型</label>
            <input
              type="text"
              value={engine.modelPath ?? ''}
              placeholder="b18c384nbt-*.bin.gz 的完整路径"
              onChange={(e) => setEngine({ ...engine, modelPath: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>human SL 模型</label>
            <input
              type="text"
              value={engine.humanModelPath ?? ''}
              placeholder="b18c384nbt-humanv0.bin.gz（1~11 级必需，不填就只能靠低 visits）"
              onChange={(e) => setEngine({ ...engine, humanModelPath: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>配置文件</label>
            <input
              type="text"
              value={engine.configPath ?? ''}
              placeholder="gtp_xingyi_cuda.cfg（可留空，用默认参数启动）"
              onChange={(e) => setEngine({ ...engine, configPath: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>后端</label>
            <select value={engine.backend} onChange={(e) => setEngine({ ...engine, backend: e.target.value as 'cuda' })}>
              {Object.entries(backendLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="controls" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void probe()} disabled={busy === 'probe'}>
              {busy === 'probe' ? '探测中…' : '探测硬件'}
            </button>
            <button className="btn btn-primary" onClick={() => void runCheck()} disabled={busy === 'check'}>
              {busy === 'check' ? '自检中…' : '保存并自检'}
            </button>
            <button className="btn" onClick={() => void restart()} disabled={busy === 'restart'}>
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
            引擎与权重需自行下载（体积与许可证不适合放进仓库）。安装步骤见仓库 <code>docs/引擎安装.md</code>。
            没有引擎也可以用「自在 + 离线对手」把棋盘和规则玩起来。
          </div>
        </section>

        <section className="panel">
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

          <div className="field" style={{ marginTop: 16 }}>
            <label>音效</label>
            <select
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
            <label>音量</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(ui.soundVolume * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  setUi({ ...ui, soundVolume: v });
                  configureSound({ volume: v });
                }}
                onMouseUp={(e) => {
                  const v = Number((e.target as HTMLInputElement).value) / 100;
                  void save({ ui: { ...ui, soundVolume: v } });
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
          <div className="field">
            <label>落子虚影</label>
            <select
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
            <label>分析深度</label>
            <select
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

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">名家</span>
            <span className="panel-sub">印面刻的就是它</span>
          </div>
          <div className="field">
            <label>你的名字</label>
            <input type="text" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="controls" style={{ marginTop: 8 }}>
            <button
              className="btn"
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
            <a className="btn" href="/api/progress/export" download="xingyi-progress.json">
              导出进度
            </a>
          </div>
          <div className="hint">导出的是 JSON（存档 + 等级表），换机器时留个备份。不自动导入。</div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">评级沙盘</span>
            <span className="panel-sub">只在副本上跑，不动存档</span>
          </div>
          <div className="hint">
            等级表已实测（约 90 分/级）。想看升降手感可以用沙盘：从你当前级起跑 12 盘，三种走势各跑一遍。
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
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">关于</span>
            <span className="panel-sub">v{bootstrap.version}</span>
          </div>
          <div className="hint" style={{ lineHeight: 2 }}>
            星弈 · 开源围棋修炼软件（MIT）。规则只做中国规则：数子、贴 7.5 目。
            <br />
            等级 1~15 为业余向成长线，满级不是本机最强（KataGo 全力远超人类）。
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
      </div>
    </div>
  );
}
