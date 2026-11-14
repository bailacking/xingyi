import { describe, expect, it } from 'vitest';
import { BLACK, EMPTY, WHITE } from '@xingyi/rules';
import { lessonMarkers, passLesson, playLessonPoint, scoreLesson, startLesson } from '../src/modes/rulesCourse';

const point = (x: number, y: number) => y * 9 + x;

describe('围棋入门练习', () => {
  it('黑先白后，重复点已有棋子不会推进真实手数', () => {
    const center = point(4, 4);
    const afterReply = playLessonPoint('turns', startLesson('turns'), center);
    expect(afterReply.game.moves.map((move) => move.color)).toEqual(['B', 'W']);
    expect(afterReply.game.toPlay).toBe('B');
    expect(playLessonPoint('turns', afterReply, point(0, 0)).complete).toBe(false);
    expect(playLessonPoint('turns', afterReply, center).complete).toBe(true);
    expect(afterReply.game.ply).toBe(2);
  });

  it('正确识别角上共用的三口气，提示与重复点击不会增加已找到的数量', () => {
    let state = startLesson('liberties');
    const shared = point(1, 1);
    expect(lessonMarkers('liberties', state, true)).toEqual([point(2, 0), shared, point(0, 2)]);
    state = playLessonPoint('liberties', state, shared);
    state = playLessonPoint('liberties', state, shared);
    state = playLessonPoint('liberties', state, point(2, 2));
    expect(state.selected).toEqual([shared]);
    state = playLessonPoint('liberties', state, point(2, 0));
    state = playLessonPoint('liberties', state, point(0, 2));
    expect(state.complete).toBe(true);
    expect(state.game.ply).toBe(0);
  });

  it('堵住最后一口气时提掉整块白棋', () => {
    let state = startLesson('capture');
    state = playLessonPoint('capture', state, point(0, 0));
    expect(state.game.ply).toBe(0);
    state = playLessonPoint('capture', state, point(6, 4));
    expect(state.complete).toBe(true);
    expect(state.game.board.at(point(4, 4))).toBe(EMPTY);
    expect(state.game.board.at(point(5, 4))).toBe(EMPTY);
    expect(state.game.captures.W).toBe(2);
  });

  it('禁止自杀，但允许提子后获得气的落子', () => {
    let state = startLesson('suicide');
    state = playLessonPoint('suicide', state, point(4, 4));
    expect(state.game.ply).toBe(0);
    expect(state.game.board.at(point(4, 4))).toBe(EMPTY);
    state = playLessonPoint('suicide', state, point(0, 1));
    expect(state.complete).toBe(true);
    expect(state.game.board.at(point(0, 1))).toBe(BLACK);
    expect(state.game.board.groupAt(point(0, 1)).liberties).toEqual([point(0, 0)]);
  });

  it('拦住立即提回，别处交换后允许提回', () => {
    let state = startLesson('ko');
    const retake = point(1, 1);
    state = playLessonPoint('ko', state, retake);
    expect(state.stage).toBe(1);
    expect(state.game.ply).toBe(1);
    expect(state.game.toPlay).toBe('W');
    expect(state.game.board.at(retake)).toBe(EMPTY);
    state = playLessonPoint('ko', state, point(8, 0));
    state = playLessonPoint('ko', state, retake);
    expect(state.complete).toBe(true);
    expect(state.game.board.at(retake)).toBe(WHITE);
    expect(state.game.board.at(point(2, 1))).toBe(EMPTY);
  });

  it('两次停手后才能标死，取消标记后无法数子，最终结果包括贴目和单官', () => {
    let state = startLesson('score');
    const dead = point(0, 0);
    expect(state.game.board.groupAt(dead).liberties).toEqual([point(0, 1)]);
    expect(playLessonPoint('score', state, dead)).toBe(state);
    state = passLesson(state);
    expect(state.game.toPlay).toBe('W');
    state = passLesson(state);
    expect(state.game.status).toBe('scoring');
    expect(playLessonPoint('score', state, point(3, 0)).selected).toEqual([]);
    state = playLessonPoint('score', state, dead);
    state = playLessonPoint('score', state, dead);
    expect(scoreLesson(state).complete).toBe(false);
    state = playLessonPoint('score', state, dead);
    state = scoreLesson(state);
    expect(state.complete).toBe(true);
    expect(state.game.status).toBe('finished');
    const score = state.game.score();
    expect(score).toMatchObject({ blackArea: 36, whiteArea: 27, komi: 7.5, winner: 'B', margin: 1.5 });
    expect(score.blackTerritory).toContain(dead);
    expect([...score.blackTerritory, ...score.whiteTerritory]).not.toContain(point(4, 0));
  });
});
