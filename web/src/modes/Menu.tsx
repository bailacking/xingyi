import { MODE_NAMES, MODE_TAGLINES, levelCn, type Mode, type ProgressView } from '../types';

interface MenuProps {
  progress: ProgressView;
  engineReady: boolean;
  onSelect: (mode: Mode) => void;
  onSettings: () => void;
}

export function Menu({ progress, engineReady, onSelect, onSettings }: MenuProps) {
  const modes: { mode: Mode; disabled: boolean; note?: string }[] = [
    { mode: 'ranked', disabled: !engineReady, note: engineReady ? undefined : '需先配置引擎' },
    { mode: 'free', disabled: false },
    { mode: 'lan', disabled: true, note: 'P5 开放' },
  ];

  return (
    <div className="menu">
      <div className="menu-inner">
        <div className="menu-eyebrow">本地围棋 · 以练为主</div>
        <h1 className="menu-title">星弈</h1>
        <div className="menu-sub">
          {progress.placement.done
            ? `${progress.playerName} · ${progress.levelCn}${progress.provisional ? '（暂定）' : ''}`
            : '尚未定级'}
        </div>
        <div className="gold-line menu-rule" />

        <div className="modes">
          {modes.map(({ mode, disabled, note }) => (
            <button
              key={mode}
              className="mode-row"
              disabled={disabled}
              onClick={() => !disabled && onSelect(mode)}
              title={note}
            >
              <span className="mode-name">{MODE_NAMES[mode]}</span>
              <span className="mode-tag">{note ?? MODE_TAGLINES[mode]}</span>
            </button>
          ))}
        </div>

        <div className="menu-foot">
          <button className="linkish" onClick={onSettings}>
            设置
          </button>
          <button
            className="linkish"
            onClick={() => window.alert('星弈跑在浏览器里，关掉这个标签页就是退出。')}
          >
            退出
          </button>
        </div>

        {!engineReady && (
          <div className="hint" style={{ marginTop: 30, lineHeight: 1.9 }}>
            还没配置 KataGo：现在可以进「自在」用离线对手试手，棋盘与规则都是真的。
            <br />
            修习需要引擎，配好后在菜单里就能进。
          </div>
        )}
        {!progress.ranksCalibrated && progress.placement.done && (
          <div className="hint" style={{ marginTop: 12 }}>
            等级校准分尚未实测，升降级幅度只是初版参数（设置页可看当前等级表状态）。
          </div>
        )}
        {progress.streak >= 2 && <div className="stage-note">{levelCn(Math.abs(progress.streak)).replace('级', '')}连胜</div>}
      </div>
    </div>
  );
}

export function LanPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <div className="menu">
      <div className="menu-inner">
        <h1 className="menu-title" style={{ fontSize: 56 }}>
          手谈
        </h1>
        <div className="gold-line menu-rule" />
        <div className="hint" style={{ marginTop: 26, lineHeight: 2 }}>
          局域网对战还没开工（P5）。
          <br />
          计划：房主起服务 → 显示 6 位房间码 + 二维码 → 手机扫码即入。
          <br />
          联机纯净：不共享 AI 推荐，不计入升级进度。
        </div>
        <div className="menu-foot">
          <button className="linkish" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
