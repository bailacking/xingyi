import { MODE_NAMES, MODE_TAGLINES, levelCn, type Mode, type ProgressView } from '../types';

interface MenuProps {
  progress: ProgressView;
  engineReady: boolean;
  onSelect: (mode: Mode) => void;
  onSettings: () => void;
  onLearn: () => void;
}

export function Menu({ progress, engineReady, onSelect, onSettings, onLearn }: MenuProps) {
  const modes: { mode: Mode; disabled: boolean; note?: string }[] = [
    { mode: 'ranked', disabled: false, note: engineReady ? undefined : '查看战绩与开局条件' },
    { mode: 'free', disabled: false },
    { mode: 'lan', disabled: false, note: '局域网 · 不计进度' },
  ];

  return (
    <div className="menu">
      <div className="menu-inner">
        <div className="menu-eyebrow">本地围棋 · 以练为主</div>
        <h1 className="menu-title">星弈</h1>
        <div className="menu-sub">
          {!progress.activeSaveId ? '未选择修习存档' : progress.placement.done
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
          <button className="linkish" onClick={onLearn}>
            教学
          </button>
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
            「自在」可用离线对手。完成 KataGo 与双模型配置后即可进入「修习」。
          </div>
        )}
        {!progress.ranksCalibrated && (
          <div className="hint" style={{ marginTop: 12 }}>
            二十五级为新手起点。一级以职业初段为校准目标，当前难度曲线为暂定。
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
