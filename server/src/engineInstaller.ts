import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { detectHardware, EngineManager } from '@xingyi/engine';
import { BEGINNER_LEVEL, DEFAULT_KOMI, isValidVertex, type Backend, type EngineInstallStatus } from '@xingyi/shared';
import type { AppConfig } from './config.js';

interface Asset {
  release: string;
  name: string;
  size: number;
  sha256: string;
}

const RELEASES = 'https://github.com/lightvector/KataGo/releases/download';
const BINARIES: Record<Backend, Asset> = {
  cuda: {
    release: 'v1.18.2', name: 'katago-v1.18.2-cuda12.1-cudnn9.8.0-windows-x64.zip', size: 9748641,
    sha256: 'b8e40a7e278be20418d8be8965d47f181841a00d99b56d4a421f070391f85b4d',
  },
  directml: {
    release: 'v1.18.1', name: 'katago-v1.18.1-onnx1.24.4-directml-windows-x64.zip', size: 23584379,
    sha256: 'cc5ab3923344a2c35b023307794850b5453f1f7ebbd80b7372bf4485d9ce37ee',
  },
  opencl: {
    release: 'v1.18.1', name: 'katago-v1.18.1-opencl-windows-x64.zip', size: 6004137,
    sha256: '1710db1903ab921aa6837a9599c8474f8a59f057650217c5d9bc125ee393a9ff',
  },
  eigen: {
    release: 'v1.18.1', name: 'katago-v1.18.1-eigen-windows-x64.zip', size: 5903072,
    sha256: '074485cf150c38aa3bb14ac9f54f2952ffefbceb44673709bbb8a83650bf95d6',
  },
};

const MAIN_MODEL: Asset = {
  release: 'v1.12.0', name: 'b18c384nbt-uec.bin.gz', size: 97610638,
  sha256: 'dd6a372c5496267347bd7c977b617f730f4d9198a2a075cc3d1a1047b4da5c4c',
};
const HUMAN_MODEL: Asset = {
  release: 'v1.15.0', name: 'b18c384nbt-humanv0.bin.gz', size: 99066230,
  sha256: '637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5',
};
const run = promisify(execFile);
const MB = 1024 * 1024;

function windowsTool(name: string): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
}

async function verified(file: string, asset: Asset): Promise<boolean> {
  if (fs.statSync(file, { throwIfNoEntry: false })?.size !== asset.size) return false;
  const hash = createHash('sha256');
  for await (const data of fs.createReadStream(file)) hash.update(data as Buffer);
  return hash.digest('hex') === asset.sha256;
}

function releaseConfig(defaults: string, backend: Backend): string {
  const settings = {
    rules: 'chinese',
    logToStderr: 'true',
    logAllGTPCommunication: 'false',
    ponderingEnabled: 'false',
    numSearchThreads: '4',
    nnMaxBatchSize: backend === 'eigen' ? '1' : '8',
    nnCacheSizePowerOfTwo: '18',
    reportAnalysisWinratesAs: 'BLACK',
    maxVisits: '500',
    ...(backend === 'directml' ? { onnxProvider: 'directml' } : {}),
  };
  const base = defaults.split(/\r?\n/).filter((line) => {
    const name = /^\s*(\w+)\s*=/.exec(line)?.[1];
    return !name || !Object.hasOwn(settings, name);
  });
  return [...base, ...Object.entries(settings).map(([k, v]) => `${k} = ${v}`), ''].join('\n');
}

export class EngineInstaller {
  static readonly supported = process.platform === 'win32' && process.arch === 'x64';
  status: EngineInstallStatus = { phase: 'idle', message: '' };
  private job: Promise<void> | null = null;

  constructor(private readonly directory: string) {}

  get running(): boolean {
    return this.job !== null;
  }

  start(current: AppConfig['engine'], activate: (config: AppConfig['engine'], engine: EngineManager) => void): void {
    if (this.job) return;
    this.status = { phase: 'detecting', message: '正在识别显卡与现有的 KataGo 文件…' };
    this.job = this.install(current, activate).catch((error: unknown) => {
      this.status = { phase: 'failed', message: error instanceof Error ? error.message : '安装失败，可以重试。' };
    }).finally(() => { this.job = null; });
  }

  private async download(asset: Asset, label: string): Promise<string> {
    const cache = path.join(this.directory, 'downloads');
    fs.mkdirSync(cache, { recursive: true });
    const destination = path.join(cache, asset.name);
    if (await verified(destination, asset)) return destination;
    const tmp = `${destination}.part`;
    if ((fs.statSync(tmp, { throwIfNoEntry: false })?.size ?? 0) >= asset.size) {
      if (await verified(tmp, asset)) {
        fs.renameSync(tmp, destination);
        return destination;
      }
      fs.rmSync(tmp, { force: true });
    }
    const progress = () => {
      const bytes = fs.statSync(tmp, { throwIfNoEntry: false })?.size ?? 0;
      this.status = {
        phase: 'downloading',
        message: `正在下载${label} · ${Math.floor(bytes / MB)} / ${Math.ceil(asset.size / MB)} MB`,
      };
    };
    progress();
    const timer = setInterval(progress, 500);
    try {
      await run(windowsTool('curl.exe'), [
        '--disable', '--silent', '--show-error', '--fail', '--location', '--proto', '=https',
        '--proto-redir', '=https', '--connect-timeout', '20', '--retry', '2', '--retry-max-time', '60',
        '--max-time', '900', '--max-filesize', String(asset.size), '--continue-at', '-', '--output', tmp,
        `${RELEASES}/${asset.release}/${asset.name}`,
      ], { windowsHide: true });
    } catch {
      throw new Error(`下载${label}失败，请检查能否访问 GitHub 后重试。已下载的内容会保留。`);
    } finally {
      clearInterval(timer);
    }
    if (!await verified(tmp, asset)) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`${label}的文件校验失败，请重试。`);
    }
    fs.renameSync(tmp, destination);
    return destination;
  }

  private async tryEngine(
    config: AppConfig['engine'],
    activate: (config: AppConfig['engine'], engine: EngineManager) => void,
  ): Promise<boolean> {
    this.status = { phase: 'checking', message: `正在验证 ${config.backend.toUpperCase()} · 加载两个模型并试下一手，首次可能较久` };
    const candidate = new EngineManager({ ...config, startupTimeoutMs: 180000 });
    let usable = false;
    try {
      const check = await candidate.selfCheck();
      if (!check.ok || !check.humanSL) return false;
      const move = await candidate.genmove('B', BEGINNER_LEVEL, { size: 9, komi: DEFAULT_KOMI, moves: [] }, 60000, true);
      usable = !move.resign && isValidVertex(9, move.vertex);
    } catch {
      return false;
    } finally {
      if (!usable) await candidate.stop();
    }
    if (!usable) return false;
    try {
      activate(config, candidate);
    } catch (error) {
      await candidate.stop();
      throw error;
    }
    this.status = { phase: 'ready', message: `KataGo 已就绪 · ${config.backend.toUpperCase()} · 主模型和人类棋风模型已验证` };
    return true;
  }

  private async install(
    current: AppConfig['engine'],
    activate: (config: AppConfig['engine'], engine: EngineManager) => void,
  ): Promise<void> {
    if (current.binaryPath && current.modelPath && current.humanModelPath && await this.tryEngine(current, activate)) return;
    const hardware = await detectHardware();
    const backends: Backend[] = hardware.nvidiaSmi ? ['cuda', 'directml', 'opencl', 'eigen']
      : hardware.gpus.length ? ['directml', 'opencl', 'eigen'] : ['eigen'];
    fs.mkdirSync(this.directory, { recursive: true });
    const stage = fs.mkdtempSync(path.join(this.directory, 'install-'));
    try {
      const modelPath = await this.download(MAIN_MODEL, '主模型');
      const humanModelPath = await this.download(HUMAN_MODEL, '人类棋风模型');
      let downloadError: Error | undefined;
      for (const backend of backends) {
        const asset = BINARIES[backend];
        let archive: string;
        try {
          archive = await this.download(asset, `KataGo（${backend.toUpperCase()}）`);
        } catch (error) {
          if (error instanceof Error) downloadError = error;
          continue;
        }
        const target = path.join(stage, backend);
        fs.mkdirSync(target);
        // Only extract pinned official archives that matched the full SHA-256.
        try {
          await run(windowsTool('tar.exe'), ['-xf', archive, '-C', target], { windowsHide: true, timeout: 60000 });
        } catch {
          throw new Error('无法解压 KataGo，请检查磁盘空间与 Windows 的 tar 工具后重试。');
        }
        const installed = path.join(this.directory, path.basename(stage) + '-' + backend);
        fs.renameSync(target, installed);
        let active = false;
        try {
          const configPath = path.join(installed, 'xingyi.cfg');
          const defaults = fs.readFileSync(path.join(installed, 'default_gtp.cfg'), 'utf8');
          fs.writeFileSync(configPath, releaseConfig(defaults, backend), 'utf8');
          const config = { backend, configPath, binaryPath: path.join(installed, 'katago.exe'), modelPath, humanModelPath, extraArgs: [], startupTimeoutMs: 180000 };
          active = await this.tryEngine(config, activate);
          if (active) return;
        } finally {
          if (!active) {
            await fs.promises.rm(installed, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 }).catch(() => undefined);
          }
        }
      }
      throw downloadError ?? new Error('下载完成，但 KataGo 未能通过实测。请检查显卡驱动，或在高级设置中选择已有的 KataGo。');
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}
