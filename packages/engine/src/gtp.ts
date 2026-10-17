import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface GtpSessionOptions {
  binary: string;
  args: string[];
  cwd?: string;
  /** 单条命令默认超时 */
  defaultTimeoutMs?: number;
}

interface Pending {
  id: number;
  command: string;
  lines: string[];
  timer: NodeJS.Timeout;
  resolve: (value: string) => void;
  reject: (err: Error) => void;
}

interface CurrentResponse {
  ok: boolean;
  id: number | null;
  lines: string[];
}

/**
 * GTP 会话：spawn 子进程、行读写、请求**串行**（一条响应没回来不发下一条）。
 * 参考 KataGo docs/GTP_Extensions.md 与 GTP 规范：
 * 响应以 `=`（成功）或 `?`（失败）开头，可带 id，空行结束。
 */
export class GtpSession extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private current: CurrentResponse | null = null;
  private queue: Pending[] = [];
  private seq = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private analysisSink: ((line: string) => void) | null = null;
  private stopped = false;

  constructor(private readonly opts: GtpSessionOptions) {
    super();
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  get running(): boolean {
    return Boolean(this.proc) && !this.stopped;
  }

  start(): void {
    if (this.proc) return;
    this.stopped = false;
    const proc = spawn(this.opts.binary, this.opts.args, {
      cwd: this.opts.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.consume(chunk));
    proc.stderr.on('data', (chunk: string) => this.emit('stderr', chunk));
    proc.on('error', (err) => {
      this.failAll(new Error(`无法启动引擎：${err.message}`));
      this.emit('crashed', err);
    });
    proc.on('exit', (code, signal) => {
      this.proc = null;
      const reason = this.stopped ? '已停止' : `引擎进程退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`;
      this.failAll(new Error(reason));
      this.emit('exit', code, signal, this.stopped);
    });
    this.emit('started', proc.pid);
  }

  stop(): void {
    this.stopped = true;
    if (!this.proc) return;
    try {
      this.proc.stdin.write('quit\n');
    } catch {
      /* 已断开 */
    }
    const proc = this.proc;
    setTimeout(() => {
      if (proc && !proc.killed) {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }
    }, 1500).unref?.();
  }

  private failAll(err: Error): void {
    const list = this.queue.splice(0);
    for (const p of list) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.current = null;
    this.analysisSink = null;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      this.handleLine(line);
      idx = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    // 分析流：没有在等响应时，info/rootInfo/ownership 行直接交给收集器
    if (this.analysisSink && !this.current) {
      if (/^(info|rootInfo|ownership|ownershipStdev)\b/.test(line)) {
        this.analysisSink(line);
        return;
      }
      // 实测（KataGo v1.18.2）：`kata-analyze` 的应答是 `=` 行**紧接着** info 行，
      // 中间没有空行收尾。若把它当作普通响应开头，后面的 info 会被吞进响应体，
      // 分析永远拿不到数据（假引擎最初写成 `=` 空行 + info，掩盖了这个 bug）。
      if (line[0] === '=' || line[0] === '?') return;
    }
    if (line === '') {
      if (this.current) this.finishCurrent();
      return;
    }
    if (line[0] === '=' || line[0] === '?' || /^\d/.test(line)) {
      if (this.current) this.finishCurrent();
      // GTP 规范：`[id] status [content]`（id 在状态符之前）。
      // 也有实现写成 `status [id] content`，两种都认；先试规范形式，避免吃掉正文开头数字。
      const withId = /^\s*(\d+)\s*([=?])\s?(.*)$/.exec(line);
      const withoutId = withId ? null : /^\s*([=?])\s*(\d*)\s?(.*)$/.exec(line);
      if (!withId && !withoutId) {
        this.emit('stray', line);
        return;
      }
      const id = withId ? Number(withId[1]) : withoutId![2] ? Number(withoutId![2]) : null;
      const ok = (withId ? withId[2] : withoutId![1]) === '=';
      const body = (withId ? withId[3] : withoutId![3]) ?? '';
      this.current = { ok, id, lines: body ? [body] : [] };
      return;
    }
    if (this.current) {
      this.current.lines.push(line);
      return;
    }
    this.emit('stray', line);
  }

  private finishCurrent(): void {
    const resp = this.current;
    this.current = null;
    if (!resp) return;
    const entry =
      (resp.id !== null ? this.queue.find((p) => p.id === resp.id) : undefined) ?? this.queue[0];
    if (!entry) return;
    this.queue = this.queue.filter((p) => p !== entry);
    clearTimeout(entry.timer);
    const text = resp.lines.join('\n').trim();
    if (resp.ok) entry.resolve(text);
    else entry.reject(new Error(text || '引擎返回错误'));
  }

  /** 串行发送一条命令，返回响应正文（已 trim）。 */
  send(command: string, timeoutMs = this.opts.defaultTimeoutMs ?? 20000): Promise<string> {
    const run = () => this.rawSend(command, timeoutMs);
    const p = this.tail.then(run, run);
    this.tail = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  /**
   * 不走队列、立即发送。**只能在 `exclusive()` 内部调用**，
   * 否则会和排队中的命令抢 stdout、把响应配对弄错。
   */
  sendNow(command: string, timeoutMs = this.opts.defaultTimeoutMs ?? 20000): Promise<string> {
    return this.rawSend(command, timeoutMs);
  }

  private rawSend(command: string, timeoutMs: number): Promise<string> {
    if (!this.proc) return Promise.reject(new Error('引擎未启动'));
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.queue = this.queue.filter((p) => p.id !== id);
        reject(new Error(`引擎 ${Math.round(timeoutMs / 1000)} 秒未响应：${command.split(' ')[0]}`));
      }, timeoutMs);
      this.queue.push({ id, command, lines: [], timer, resolve, reject });
      try {
        this.proc!.stdin.write(`${id} ${command}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.queue = this.queue.filter((p) => p.id !== id);
        reject(err as Error);
      }
    });
  }

  /** 直接写一行（分析流用；不占队列）。 */
  writeRaw(line: string): void {
    if (!this.proc) throw new Error('引擎未启动');
    this.proc.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
  }

  /** 启动分析流，后续 info 行回调给 sink。 */
  beginAnalysis(sink: (line: string) => void): void {
    this.analysisSink = sink;
  }

  /**
   * 结束分析流：按 KataGo 文档，收到任意新命令或**原始换行**即终止
   * （"if any new GTP command or a raw newline is received, then it will terminate"）。
   */
  endAnalysis(): void {
    this.analysisSink = null;
    if (this.proc) {
      try {
        this.proc.stdin.write('\n');
      } catch {
        /* ignore */
      }
    }
  }

  /** 分析请求与 move 共用一条串行链，避免打断对方的响应。 */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => fn();
    const p = this.tail.then(run, run);
    this.tail = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}
