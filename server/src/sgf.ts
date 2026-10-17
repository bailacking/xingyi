import {
  PASS,
  sgfToVertex,
  vertexToSgf,
  type BoardSize,
  type Color,
  type Vertex,
} from '@xingyi/shared';

/** SGF 节点：属性 + 子节点（变体）。PLAN D8：数据结构从第一行代码起就是树。 */
export interface SgfNode {
  properties: Record<string, string[]>;
  children: SgfNode[];
}

export interface ParsedSgf {
  root: SgfNode;
  size: BoardSize | number;
  komi: number;
  rules: string;
  playerBlack: string | null;
  playerWhite: string | null;
  /** 主线着法（AI/界面用） */
  mainLine: { color: Color; vertex: Vertex }[];
  setup: { black: Vertex[]; white: Vertex[] };
  /** 变体分支数量（>0 说明棋谱带变化图） */
  variationCount: number;
  result: string | null;
}

class SgfReader {
  private i = 0;
  constructor(private readonly s: string) {}

  private peek(): string {
    return this.s[this.i] ?? '';
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) throw new Error(`SGF 格式错误：期待 ${ch}，实际 ${this.peek() || 'EOF'}`);
    this.i++;
  }

  parseCollection(): SgfNode[] {
    const trees: SgfNode[] = [];
    this.ws();
    while (this.peek() === '(') {
      trees.push(this.parseGameTree());
      this.ws();
    }
    return trees;
  }

  private parseGameTree(): SgfNode {
    this.expect('(');
    const sequence = this.parseSequence();
    const branches: SgfNode[] = [];
    this.ws();
    let peek = this.peek();
    while (peek === '(') {
      branches.push(this.parseGameTree());
      this.ws();
      peek = this.peek();
    }
    if (this.peek() === ')') this.i++;
    const last = sequence[sequence.length - 1];
    if (!last) return branches[0] ?? { properties: {}, children: [] };
    last.children.push(...branches);
    return sequence[0]!;
  }

  private parseSequence(): SgfNode[] {
    const nodes: SgfNode[] = [];
    this.ws();
    while (this.peek() === ';') {
      this.i++;
      nodes.push(this.parseNode());
    }
    // 线性串联，末尾节点挂分支（parseGameTree 负责）
    for (let k = 0; k < nodes.length - 1; k++) nodes[k]!.children.push(nodes[k + 1]!);
    return nodes;
  }

  private parseNode(): SgfNode {
    const properties: Record<string, string[]> = {};
    for (;;) {
      this.ws();
      const c = this.peek();
      if (!/[A-Za-z]/.test(c)) break;
      let id = '';
      while (/[A-Za-z]/.test(this.peek())) id += this.s[this.i++];
      const values: string[] = [];
      for (;;) {
        this.ws();
        if (this.peek() !== '[') break;
        values.push(this.readValue());
      }
      properties[id.toUpperCase()] = values;
    }
    return { properties, children: [] };
  }

  private readValue(): string {
    this.expect('[');
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '\\') {
        const n = this.s[this.i++];
        if (n !== '\n') out += n ?? '';
      } else if (c === ']') {
        return out;
      } else {
        out += c;
      }
    }
    throw new Error('SGF 格式错误：属性值未闭合');
  }
}

export function parseSgf(text: string): ParsedSgf {
  const reader = new SgfReader(text);
  const trees = reader.parseCollection();
  const root = trees[0];
  if (!root) throw new Error('SGF 内容为空');
  const p = root.properties;
  const size = Number(p.SZ?.[0] ?? 19) || 19;
  const komi = Number(p.KM?.[0] ?? 7.5);
  const setup = {
    black: (p.AB ?? []).map((s) => sgfToVertex(size, s)).filter((v) => v !== PASS),
    white: (p.AW ?? []).map((s) => sgfToVertex(size, s)).filter((v) => v !== PASS),
  };

  const mainLine: { color: Color; vertex: Vertex }[] = [];
  let variationCount = 0;
  let node: SgfNode | undefined = root;
  while (node) {
    if (node.properties.B?.length) {
      mainLine.push({ color: 'B', vertex: sgfToVertex(size, node.properties.B[0]!) });
    } else if (node.properties.W?.length) {
      mainLine.push({ color: 'W', vertex: sgfToVertex(size, node.properties.W[0]!) });
    }
    if (node.children.length > 1) variationCount += node.children.length - 1;
    node = node.children[0];
  }

  return {
    root,
    size,
    komi,
    rules: p.RU?.[0] ?? 'Chinese',
    playerBlack: p.PB?.[0] ?? null,
    playerWhite: p.PW?.[0] ?? null,
    mainLine,
    setup,
    variationCount,
    result: p.RE?.[0] ?? null,
  };
}

export interface SgfExportInput {
  size: number;
  komi: number;
  moves: { color: Color; vertex: Vertex }[];
  setup?: { black: Vertex[]; white: Vertex[] };
  playerBlack?: string;
  playerWhite?: string;
  result?: string | null;
  comment?: string;
}

/** 导出主线棋谱；摆子用 AB/AW（保证 Sabaki / Lizzie 能打开，PLAN §12）。 */
export function toSgf(input: SgfExportInput): string {
  const head: string[] = [
    'GM[1]',
    'FF[4]',
    'CA[UTF-8]',
    'AP[xingyi:0.1.0]',
    `SZ[${input.size}]`,
    `KM[${input.komi}]`,
    'RU[Chinese]',
  ];
  if (input.playerBlack) head.push(`PB[${escapeValue(input.playerBlack)}]`);
  if (input.playerWhite) head.push(`PW[${escapeValue(input.playerWhite)}]`);
  if (input.result) head.push(`RE[${escapeValue(input.result)}]`);
  if (input.setup?.black.length) head.push(`AB${input.setup.black.map((v) => `[${vertexToSgf(input.size, v)}]`).join('')}`);
  if (input.setup?.white.length) head.push(`AW${input.setup.white.map((v) => `[${vertexToSgf(input.size, v)}]`).join('')}`);
  if (input.comment) head.push(`C[${escapeValue(input.comment)}]`);
  const body = input.moves
    .map((m) => `;${m.color}[${m.vertex === PASS ? '' : vertexToSgf(input.size, m.vertex)}]`)
    .join('');
  return `(;${head.join('')}${body})`;
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}
