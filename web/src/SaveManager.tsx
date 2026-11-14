import { useEffect, useState } from 'react';
import { api, ApiError, type SaveList } from './api';
import { levelCn } from './types';

export function SaveManager({ onChange }: { onChange: () => Promise<void> }) {
  const [list, setList] = useState<SaveList | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<SaveList['saves'][number] | null>(null);

  const load = async () => {
    try {
      setList(await api.saves());
      setMessage('');
    } catch {
      setMessage('暂时无法读取存档，请重试。');
    }
  };
  useEffect(() => { void load(); }, []);

  const change = async (operation: () => Promise<SaveList>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      setList(await operation());
      setDeleting(null);
      setName('');
      await onChange();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '存档操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const locked = busy || list?.locked;
  return (
    <section className="panel" id="saves">
      <div className="panel-head"><span className="panel-title">存档管理</span></div>
      {!list && <button type="button" className="btn" onClick={() => void load()}>读取存档</button>}
      {list?.locked && <p className="hint">有一盘修习正在进行，结算后可以切换、创建或删除存档。</p>}
      {list?.saves.length === 0 && <p className="hint">还没有存档。新建后即可开始修习定级。</p>}
      {list && <ul className="save-list">
        {list.saves.map((save) => (
          <li key={save.id} className="save-row">
            <div>
              <strong>{save.name}</strong> {save.id === list.activeId && <span className="badge">当前</span>}
              <div className="hint">{save.readable ? `${save.gamesTotal} 局 · ${save.level ? levelCn(save.level) : '未定级'}` : '无法读取'}</div>
            </div>
            <div className="controls">
              {save.id !== list.activeId && <button className="btn" disabled={locked || !save.readable} onClick={() => void change(() => api.activateSave(save.id), `已切换到「${save.name}」`)}>使用</button>}
              {save.readable && <a className="btn" href={api.saveExportUrl(save.id)} download aria-label={`导出${save.name}`}>导出</a>}
              <button className="btn" disabled={locked} onClick={() => setDeleting(save)} aria-label={`删除${save.name}`}>删除</button>
            </div>
          </li>
        ))}
      </ul>}
      {deleting && <div className="notice" role="group" aria-label="确认删除存档">
        <p>删除「{deleting.name}」会清除该档的修习进度和自动备份。已保存的棋谱会保留。</p>
        {deleting.readable && <p><a href={api.saveExportUrl(deleting.id)} download>先导出这份存档</a></p>}
        <div className="controls">
          <button className="btn" disabled={busy} onClick={() => setDeleting(null)}>取消</button>
          <button className="btn save-danger" disabled={busy} onClick={() => void change(() => api.deleteSave(deleting.id), '已删除存档')}>确认删除</button>
        </div>
      </div>}
      {list && <form className="controls save-create" onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !locked) void change(() => api.createSave(name.trim()), '已开始新存档');
      }}>
        <label htmlFor="new-save-name">存档名称</label>
        <input type="text" id="new-save-name" value={name} maxLength={12} onChange={(event) => setName(event.target.value)} />
        <button className="btn btn-primary" disabled={locked || !name.trim()}>开始新存档</button>
      </form>}
      {message && <p className="hint" role="status">{message}</p>}
    </section>
  );
}
