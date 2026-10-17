import { execFile } from 'node:child_process';
import os from 'node:os';
import type { Backend, HardwareReport } from '@xingyi/shared';

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
        if (err) resolve(null);
        else resolve(String(stdout).trim());
      });
    } catch {
      resolve(null);
    }
  });
}

async function nvidiaSmi(): Promise<{ names: string[]; vramMb: number | null } | null> {
  const out = await run('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  if (!out) return null;
  const names: string[] = [];
  let vram: number | null = null;
  for (const line of out.split(/\r?\n/)) {
    const [name, mem] = line.split(',').map((s) => s.trim());
    if (name) names.push(name);
    const m = Number(mem);
    if (Number.isFinite(m) && (vram === null || m > vram)) vram = m;
  }
  return names.length ? { names, vramMb: vram } : null;
}

async function genericGpus(): Promise<string[]> {
  if (process.platform === 'win32') {
    const out = await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name',
    ], 6000);
    return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  }
  if (process.platform === 'linux') {
    const out = await run('lspci', []);
    if (!out) return [];
    return out
      .split(/\r?\n/)
      .filter((l) => /VGA|3D|Display/i.test(l))
      .map((l) => l.replace(/^.*:\s*/, '').trim());
  }
  if (process.platform === 'darwin') {
    const out = await run('system_profiler', ['SPDisplaysDataType'], 8000);
    if (!out) return [];
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('Chipset Model:'))
      .map((l) => l.replace('Chipset Model:', '').trim());
  }
  return [];
}

/**
 * 探测硬件并推荐后端（D5：发布版必须支持 CUDA / OpenCL / Eigen 三选一）。
 * 只做"推荐 + 说明"，不替用户决定；真实可用性由引擎自检确认。
 */
export async function detectHardware(): Promise<HardwareReport> {
  const cpu = os.cpus()[0]?.model ?? '未知 CPU';
  const warnings: string[] = [];
  const nv = await nvidiaSmi();
  const gpus = nv?.names.length ? nv.names : await genericGpus();

  let recommended: Backend = 'eigen';
  let reason = '';
  if (nv) {
    recommended = 'cuda';
    reason = `检测到 NVIDIA 显卡（${nv.names[0]}${nv.vramMb ? `，${Math.round(nv.vramMb)} MB 显存` : ''}），CUDA 后端最快。`;
    if (nv.vramMb !== null && nv.vramMb < 3500) {
      warnings.push('显存偏小（<3.5 GB）：主模型与 human 模型可能无法同时加载，程序会按需切换。');
    }
  } else if (gpus.length > 0) {
    recommended = 'opencl';
    reason = `未检测到 NVIDIA 驱动（nvidia-smi 不可用），检测到显卡：${gpus.join(' / ')}，建议用 OpenCL 后端。`;
    warnings.push('OpenCL 首次启动会自动 tuner，可能耗时数分钟；部分 AMD 卡需在配置里设 openclUseFP16=false。');
  } else {
    recommended = 'eigen';
    reason = '没有检测到可用的独立显卡信息，只能用纯 CPU（Eigen 后端）。';
    warnings.push('Eigen 后端极慢（大约慢一个数量级），级数越高越明显，只适合试玩。');
  }
  warnings.push('KataGo 从 v1.18.2 起官方只发布 CUDA 构建；OpenCL / Eigen 请用 v1.18.1（待实测）。');

  return {
    os: `${os.type()} ${os.release()} (${process.arch})`,
    cpu,
    gpus,
    vramMb: nv?.vramMb ?? null,
    nvidiaSmi: Boolean(nv),
    recommended,
    reason,
    warnings,
  };
}
