import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FirstGameExercise, SavedMistake } from '@xingyi/shared';

export class MistakeNotebook {
  constructor(private readonly file: string) {}

  list(): SavedMistake[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const data = JSON.parse(raw) as { version?: number; mistakes?: SavedMistake[] } | null;
    if (data?.version !== 1 || !Array.isArray(data.mistakes)) throw new Error('错题文件格式无效');
    return data.mistakes;
  }

  save(gameId: string, makeExercise: () => FirstGameExercise, upgrade = false): SavedMistake {
    const entries = this.list();
    const existing = entries.find((entry) => entry.gameId === gameId);
    if (existing && (!upgrade || existing.exercise.kind === 'katago')) return existing;
    const entry = { gameId, exercise: makeExercise(), savedAt: new Date().toISOString(), lastPracticedAt: null };
    this.write([...entries.filter((item) => item.gameId !== gameId), entry]);
    return entry;
  }

  practice(gameId: string, check: (exercise: FirstGameExercise) => void): SavedMistake | null {
    const entries = this.list();
    const entry = entries.find((item) => item.gameId === gameId);
    if (!entry) return null;
    check(entry.exercise);
    entry.lastPracticedAt = new Date().toISOString();
    this.write(entries);
    return entry;
  }

  remove(gameId: string): void {
    const entries = this.list();
    const remaining = entries.filter((entry) => entry.gameId !== gameId);
    if (remaining.length !== entries.length) this.write(remaining);
  }

  private write(entries: SavedMistake[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, mistakes: entries }, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}
