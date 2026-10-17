import fs from 'node:fs';
import path from 'node:path';
import { normalizeProgress, type Progress } from './progress.js';

/** 读存档；不存在或损坏返回 null（由调用方决定是否新建）。 */
export function loadProgressFile(file: string, maxLevel = 15): Progress | null {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return normalizeProgress(JSON.parse(text), maxLevel);
  } catch {
    // 主档坏了试 .bak（PLAN §3.7 / D72）
    try {
      const bak = fs.readFileSync(`${file}.bak`, 'utf8');
      return normalizeProgress(JSON.parse(bak), maxLevel);
    } catch {
      return null;
    }
  }
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 写存档：先留 .bak，再原子写；每天首次写盘额外存一份到 backups/（最多留 10 份）。
 */
export function saveProgressFile(file: string, backupDir: string, p: Progress): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.bak`);
    } catch {
      /* 备份失败不阻塞主流程 */
    }
  }
  atomicWrite(file, JSON.stringify(p, null, 2));
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const daily = path.join(backupDir, `progress-${todayKey()}.json`);
    if (!fs.existsSync(daily)) atomicWrite(daily, JSON.stringify(p, null, 2));
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => /^progress-\d{8}\.json$/.test(f))
      .sort();
    for (const old of files.slice(0, Math.max(0, files.length - 10))) {
      fs.unlinkSync(path.join(backupDir, old));
    }
  } catch {
    /* 备份目录不可写时忽略 */
  }
}
