import { Game } from '@xingyi/rules';
import { DEFAULT_KOMI, PASS } from '@xingyi/shared';

export const LESSON_BOARD_SIZE = 9;
const point = (x: number, y: number) => y * LESSON_BOARD_SIZE + x;

const cornerGroup = point(0, 0);
const capturePoint = point(6, 4);
const forbiddenPoint = point(4, 4);
const koTake = point(2, 1);
const koRetake = point(1, 1);
const koElsewhere = point(8, 0);
const koReply = point(8, 1);
const deadWhite = point(0, 0);

export const RULES_LESSONS = [
  {
    id: 'turns', title: '轮流落子',
    explanation: '黑先白后，每次在棋盘的一个空交叉点放一颗棋子。边上和角上也能下。已经放下的棋子不能挪动。',
    task: '你执黑。点一个空交叉点，看白棋回应。',
  },
  {
    id: 'liberties', title: '找一找气',
    explanation: '棋子上下左右紧挨的空点叫「气」。同色棋子横竖相连就共用气，斜着相邻不算相连。几个棋子挨着同一个空点，也只算一口气。',
    task: '点出左上角三颗黑棋共用的所有气。',
  },
  {
    id: 'capture', title: '提走对方棋子',
    explanation: '堵住对方一块棋的最后一口气，就把相连的整块棋从盘上拿走，这叫「提子」。自己的棋也可能被提。',
    task: '你执黑。找到两颗白棋最后一口气，下在那一点。',
  },
  {
    id: 'suicide', title: '认识禁着点',
    explanation: '如果落子并提掉对方该提的棋后，自己的棋仍然一口气也没有，这一手就不能下。',
    task: '你执黑。试着下在四颗白棋围着的空点。',
  },
  {
    id: 'ko', title: '打劫要先下别处',
    explanation: '黑棋刚提走一颗白子。白棋如果立刻提回，整个棋盘就会回到刚才的样子。围棋禁止下出这样的重复局面，这里形成了一个「劫」。',
    task: '你执白。先试着点黑棋刚提出来的空点。',
  },
  {
    id: 'score', title: '停手与数子',
    explanation: '你觉得盘上没有想下的地方，可以停一手，让对方下。双方连续停手后，先确认死子，再数子决定胜负。',
    task: '这盘示范棋已经下到末尾。先让黑方停一手。',
  },
] as const;

type LessonId = (typeof RULES_LESSONS)[number]['id'];

export interface LessonState {
  game: Game;
  stage: number;
  selected: number[];
  feedback: string;
  complete: boolean;
}

function makeGame(id: LessonId): Game {
  const rules = { size: LESSON_BOARD_SIZE, komi: DEFAULT_KOMI, toPlay: 'B' as const };
  switch (id) {
    case 'liberties':
      return new Game({ ...rules, setup: { black: [cornerGroup, point(1, 0), point(0, 1)] } });
    case 'capture':
      return new Game({
        ...rules,
        setup: {
          black: [point(3, 4), point(4, 3), point(5, 3), point(4, 5), point(5, 5)],
          white: [point(4, 4), point(5, 4)],
        },
      });
    case 'suicide':
      return new Game({
        ...rules,
        setup: {
          black: [point(1, 0)],
          white: [point(4, 3), point(3, 4), point(5, 4), point(4, 5), point(0, 0), point(1, 1), point(0, 2)],
        },
      });
    case 'ko': {
      const game = new Game({
        ...rules,
        setup: {
          black: [point(1, 0), point(0, 1), point(1, 2)],
          white: [point(2, 0), koRetake, point(3, 1), point(2, 2)],
        },
      });
      game.play('B', koTake);
      return game;
    }
    case 'score':
      return new Game({
        ...rules,
        setup: {
          black: [
            ...Array.from({ length: LESSON_BOARD_SIZE }, (_, y) => point(3, y)),
            point(1, 0), point(1, 1), point(0, 2), point(1, 2), point(2, 2),
            point(1, 3), point(0, 4), point(1, 4), point(1, 5), point(0, 6), point(1, 6),
          ],
          white: [
            ...Array.from({ length: LESSON_BOARD_SIZE }, (_, y) => point(6, y)),
            point(7, 0), point(7, 1), point(8, 1), point(7, 2), point(7, 3), point(8, 3), deadWhite,
          ],
        },
      });
    case 'turns':
      return new Game(rules);
  }
}

export function startLesson(id: LessonId): LessonState {
  return { game: makeGame(id), stage: 0, selected: [], feedback: '', complete: false };
}

export function lessonTask(id: LessonId, stage: number): string {
  if (id === 'turns' && stage === 1) return '现在又轮到黑棋了。试着点一颗已经在盘上的棋。';
  if (id === 'suicide' && stage === 1) return '再点左上角白棋唯一的气（圆圈）。看看原本没有空邻点的落子能不能提子。';
  if (id === 'ko' && stage === 1) return '现在在右上角圆圈处下一手，黑棋会在那边回应。';
  if (id === 'ko' && stage === 2) return '全盘已经改变。回到原处试着提回黑子。';
  if (id === 'score' && stage === 1) return '黑方停手了，轮到白方。让白方也停一手。';
  if (id === 'score' && stage === 2) return '点左上角被围住的白子，把它标成死子，再确认数子。';
  return RULES_LESSONS.find((lesson) => lesson.id === id)!.task;
}

export function lessonMarkers(id: LessonId, state: LessonState, showHint: boolean): number[] {
  if (id === 'liberties') return showHint ? state.game.board.groupAt(cornerGroup).liberties : state.selected;
  if (state.complete) return [];
  if (id === 'capture' && showHint) return [capturePoint];
  if (id === 'suicide') return [state.stage === 0 ? forbiddenPoint : point(0, 1)];
  if (id === 'ko') return [state.stage === 1 ? koElsewhere : koRetake];
  if (id === 'score' && state.game.status === 'scoring' && !state.selected.length) return [deadWhite];
  return [];
}

// 由点击事件调用。棋盘更新统一交给正式对局用的 Game。
export function playLessonPoint(id: LessonId, state: LessonState, vertex: number): LessonState {
  if (state.complete) return state;
  const { game, stage, selected } = state;
  const say = (feedback: string, changes: Partial<LessonState> = {}) => ({ ...state, ...changes, feedback });
  const complete = (feedback: string) => say(feedback, { complete: true });

  if (id === 'liberties') {
    const { liberties } = game.board.groupAt(cornerGroup);
    if (!liberties.includes(vertex)) return say('找与这块黑棋横竖紧挨的空点。斜着挨到的空点不算。');
    if (selected.includes(vertex)) return say('这一口气已经数过了。');
    const found = [...selected, vertex];
    return say(found.length === liberties.length
      ? `找齐了！三颗黑棋共用 ${liberties.length} 口气，靠边也只数棋盘上的空点。`
      : `已找到 ${found.length} 口气，再看看有没有漏掉的空点。`,
    { selected: found, complete: found.length === liberties.length });
  }

  if (id === 'score') {
    if (game.status !== 'scoring') return state;
    const group = game.board.groupAt(vertex).stones;
    if (!group.includes(deadWhite)) return say('这道练习只需标记左上角的白子。它只剩一口气，也无法逃出黑棋的包围。');
    return selected.length
      ? say('已取消标记。确认数子前，先选中这颗白子。', { selected: [] })
      : say('已标记。确认数子时，这颗死子按空点处理。', { selected: group });
  }

  const preview = game.preview(game.toPlay, vertex);
  switch (id) {
    case 'turns':
      if (stage === 1) return preview.error === 'occupied'
        ? complete('有棋子的点不能再下。正式对局中，落子无效时仍然轮到你。')
        : say('那个点是空的。试着点一下棋盘上已有的黑子或白子。');
      if (!preview.ok) return say(preview.message ?? '请选一个空交叉点。');
      game.play('B', vertex);
      game.play('W', vertex === point(4, 4) ? point(5, 4) : point(4, 4));
      return say('你下了一手黑棋，白棋也落了一子。', { stage: 1 });
    case 'capture':
      if (vertex !== capturePoint || !preview.captured?.length) return say('这一步还提不走白棋。沿着两颗白棋的上下左右找空点。');
      game.play('B', vertex);
      return complete(`这块白棋没气了，${preview.captured.length} 颗白子一起被提走。`);
    case 'suicide':
      if (stage === 0) return vertex === forbiddenPoint && preview.error === 'suicide'
        ? say('这一手无效。黑棋落下后没有气，也提不走任何白棋。', { stage: 1 })
        : say('先试一试圆圈标出的空点。');
      if (vertex !== point(0, 1) || !preview.captured?.length) return say('试着堵住左上角那颗白棋的最后一口气。');
      game.play('B', vertex);
      return complete('这里可以下。白子被提后，原来白子占着的交叉点就成了黑棋的气。');
    case 'ko':
      if (stage === 0) return vertex === koRetake && preview.error === 'superko'
        ? say('立即提回会重复全盘局面，这一手无效。轮次仍然是白方。', { stage: 1 })
        : say('先试着点圆圈，看看能不能马上提回。');
      if (stage === 1) {
        if (vertex !== koElsewhere || !preview.ok) return say('请先在右上角圆圈处下一手。');
        game.play('W', vertex);
        game.play('B', koReply);
        return say('白棋在别处下了一手，黑棋也在那里应了一手。', { stage: 2 });
      }
      if (vertex !== koRetake || !preview.captured?.length) return say('回到圆圈标出的劫点提回黑子。');
      game.play('W', vertex);
      return complete('提回成功。角上的局部回到了原样，右上的两手让全盘局面变了。');
  }
}

export function passLesson(state: LessonState): LessonState {
  if (state.game.status !== 'playing') return state;
  state.game.play(state.game.toPlay, PASS);
  return {
    ...state,
    stage: state.game.consecutivePasses,
    feedback: state.game.consecutivePasses === 1
      ? '停一手会把回合交给对方。'
      : '黑白都停手了。左上角白棋已经被围死，即使先下一手也逃不出去。',
  };
}

export function scoreLesson(state: LessonState): LessonState {
  if (state.game.status !== 'scoring' || !state.selected.length) return state;
  state.game.finishByScore(state.selected);
  return { ...state, complete: true, feedback: '数子完成。棋盘上的方块标出了双方各自围住的空点。' };
}
