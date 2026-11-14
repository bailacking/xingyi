import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadProgressFile, saveProgressFile, type Progress, type RankTable } from '@xingyi/rating';
import type { DataPaths } from './paths.js';

const LEGACY = 'legacy';
const validId = (id: unknown): id is string => typeof id === 'string' && (id === LEGACY || /^[a-f\d-]{36}$/.test(id));
type Index = { activeId: string | null; ids: string[] };

/** The index commits selection and deletion atomically. Backups belong to a single save. */
export class SaveSlots {
  private readonly indexFile: string;
  private index: Index;

  constructor(private readonly paths: DataPaths, private readonly ranks: RankTable) {
    this.indexFile = path.join(paths.data, 'saves', 'index.json');
    this.index = fs.existsSync(this.indexFile) ? this.readIndex() : { activeId: LEGACY, ids: [LEGACY] };
  }

  private readIndex(): Index {
    const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as Index;
    if (!Array.isArray(index.ids) || !index.ids.every(validId) || new Set(index.ids).size !== index.ids.length ||
        (index.activeId !== null && !index.ids.includes(index.activeId))) {
      throw new Error('存档目录损坏，请检查 saves/index.json');
    }
    return index;
  }

  get activeId(): string | null { return this.index.activeId; }
  get ids(): readonly string[] { return this.index.ids; }

  private location(id: string): { file: string; backups: string } {
    if (id === LEGACY) return { file: this.paths.progressFile, backups: this.paths.backups };
    const dir = path.join(path.dirname(this.indexFile), id);
    return { file: path.join(dir, 'progress.json'), backups: path.join(dir, 'backups') };
  }

  load(id: string): Progress | null {
    return loadProgressFile(this.location(id).file, this.ranks.maxLevel, this.ranks);
  }

  save(id: string, progress: Progress): void {
    const { file, backups } = this.location(id);
    saveProgressFile(file, backups, progress);
  }

  create(progress: Progress): string {
    const id = randomUUID();
    this.save(id, progress);
    this.commit({ activeId: id, ids: [...this.ids, id] });
    return id;
  }

  select(id: string): void {
    this.commit({ activeId: id, ids: this.index.ids });
  }

  remove(id: string, activeId: string | null): void {
    this.commit({ activeId, ids: this.ids.filter((item) => item !== id) });
    const { file, backups } = this.location(id);
    // A failed cleanup must not make a deleted save selectable or resurrect it at boot.
    try {
      for (const suffix of ['', '.bak', '.v1.bak', '.tmp']) fs.rmSync(file + suffix, { force: true });
      if (fs.existsSync(backups)) {
        for (const name of fs.readdirSync(backups)) {
          if (/^progress-\d{8}\.json(?:\.tmp)?$/.test(name)) fs.rmSync(path.join(backups, name), { force: true });
        }
      }
    } catch (error) {
      console.warn('[星弈] 清理已删除的存档文件失败', error);
    }
  }

  private commit(index: Index): void {
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
    const temp = `${this.indexFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(index, null, 2), 'utf8');
      fs.renameSync(temp, this.indexFile);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.index = index;
  }
}
