/**
 * ZOO-197（常量滑块与动画播放）单测：
 * - normalizeSliderMeta / clampToSlider：滑块范围与步长裁剪（非法逐项回默认、
 *   min≥max 整体回默认、值贴界）；
 * - advanceSliderAnimation：动画步进（速率 = 量程×speed/SWEEP_MS，单程与量程
 *   无关）与往复边界（上界反射转向、下界反射转向、大 dt 多次反射贴界兜底）；
 * - constantDefaultValue / nextSliderSpeed：一键建滑块初值与速度档循环；
 * - parse missingConstants：欠定 / 缺赋值引导错误附「可一键建滑块」符号集
 *  （自变量占位剔除：x 在场保 x，否则保首个 ASCII 候选；拼写错误不带）；
 * - 链路落元素：mathPlotFieldsFromPayload / createMathPlotElement 滑块元数据
 *   裁剪落键（剔除未绑定常量键、空归一 undefined、未携带不触碰）；
 * - 旧文档零迁移：常量集为空的载荷 / 元素不落 constantSliders 键。
 */
import { describe, expect, it } from 'vitest';
import {
  advanceSliderAnimation,
  clampToSlider,
  cleanSliderMap,
  constantDefaultValue,
  DEFAULT_SLIDER,
  nextSliderSpeed,
  normalizeSliderMeta,
  roundSliderValue,
  SLIDER_SPEEDS,
  SLIDER_SWEEP_MS,
  sliderMetaFor,
} from '../slider';
import { parseEquation } from '../parse';
import { validateEquation } from '../validate';
import { createMathPlotElement, mathPlotFieldsFromPayload } from '../../mathplotElement';
import { zhT } from '../../../i18n/lib';
import type { EquationDraftPayload } from '../types';

describe('normalizeSliderMeta 滑块范围 / 步长裁剪（ZOO-197）', () => {
  it('缺省 / 空输入回落默认（-10~10、步长 0.1）', () => {
    expect(normalizeSliderMeta()).toEqual(DEFAULT_SLIDER);
    expect(normalizeSliderMeta({})).toEqual(DEFAULT_SLIDER);
  });

  it('部分字段合法则只补非法项', () => {
    expect(normalizeSliderMeta({ min: 0, max: 5 })).toEqual({ min: 0, max: 5, step: 0.1 });
    expect(normalizeSliderMeta({ min: -1, step: 0.5 })).toEqual({ min: -1, max: 10, step: 0.5 });
  });

  it('非有限数（NaN / Infinity）逐项回默认', () => {
    expect(normalizeSliderMeta({ min: Number.NaN, max: 5, step: 0.2 })).toEqual({ min: -10, max: 5, step: 0.2 });
    expect(normalizeSliderMeta({ min: 0, max: Number.POSITIVE_INFINITY })).toEqual({ min: 0, max: 10, step: 0.1 });
  });

  it('step ≤ 0 回默认步长（防除零 / 负步进）', () => {
    expect(normalizeSliderMeta({ min: 0, max: 1, step: 0 })).toEqual({ min: 0, max: 1, step: 0.1 });
    expect(normalizeSliderMeta({ min: 0, max: 1, step: -0.5 })).toEqual({ min: 0, max: 1, step: 0.1 });
  });

  it('min ≥ max 视为不可用范围：min/max 整体回默认、step 保留已裁剪值', () => {
    expect(normalizeSliderMeta({ min: 5, max: 5, step: 0.5 })).toEqual({ min: -10, max: 10, step: 0.5 });
    expect(normalizeSliderMeta({ min: 8, max: -8 })).toEqual({ ...DEFAULT_SLIDER, step: 0.1 });
  });

  it('sliderMetaFor：未自定义条目回落默认（旧文档零迁移）', () => {
    expect(sliderMetaFor(undefined, 'a')).toEqual(DEFAULT_SLIDER);
    expect(sliderMetaFor({ a: { min: 0, max: 1, step: 0.01 } }, 'a')).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(sliderMetaFor({ a: { min: 0, max: 1, step: 0.01 } }, 'b')).toEqual(DEFAULT_SLIDER);
  });
});

describe('clampToSlider / roundSliderValue 值裁剪（ZOO-197）', () => {
  const meta = { min: -2, max: 3, step: 0.1 };
  it('界内原值、越界贴界', () => {
    expect(clampToSlider(1.5, meta)).toBe(1.5);
    expect(clampToSlider(-2, meta)).toBe(-2);
    expect(clampToSlider(3, meta)).toBe(3);
    expect(clampToSlider(-9.9, meta)).toBe(-2);
    expect(clampToSlider(9.9, meta)).toBe(3);
  });

  it('非有限值贴下界（滑杆可控值兜底）', () => {
    expect(clampToSlider(Number.NaN, meta)).toBe(-2);
  });

  it('roundSliderValue 两位小数（播放逐帧写入的显示精度）', () => {
    expect(roundSliderValue(1.00500000001)).toBe(1.01);
    expect(roundSliderValue(2.344)).toBe(2.34);
  });
});

describe('advanceSliderAnimation 动画步进与往复边界（ZOO-197）', () => {
  const meta = { min: -10, max: 10, step: 0.1 };
  const rate = (speed: number) => (meta.max - meta.min) * speed / SLIDER_SWEEP_MS; // 单位 / ms

  it('正向步进：位移 = 量程 × speed × dt / SWEEP_MS', () => {
    const r = advanceSliderAnimation(0, 1, 1000, 1, meta);
    expect(r.value).toBeCloseTo(rate(1) * 1000, 10);
    expect(r.dir).toBe(1);
  });

  it('速度档只乘速率（2x 单帧位移 = 1x 两倍）', () => {
    const r1 = advanceSliderAnimation(0, 1, 500, 1, meta);
    const r2 = advanceSliderAnimation(0, 1, 500, 2, meta);
    expect(r2.value).toBeCloseTo(r1.value * 2, 10);
  });

  it('单程时长与量程无关：等比缩小量程同时缩小速率', () => {
    const wide = advanceSliderAnimation(-10, 1, SLIDER_SWEEP_MS, 1, meta); // 全量程一步走完
    expect(wide.value).toBe(10);
    const narrow = { min: 0, max: 1, step: 0.1 };
    const rn = advanceSliderAnimation(0, 1, SLIDER_SWEEP_MS, 1, narrow);
    expect(rn.value).toBe(1); // 同样一步（单程）走满
  });

  it('上界反射：越界折回、方向翻转，边界值精确等于 max', () => {
    // 起点贴近上界，一步跨过 → 折回量 = 越界量
    const r = advanceSliderAnimation(9, 1, 1000, 1, meta);
    const over = 9 + rate(1) * 1000 - 10; // 越界量
    expect(r.value).toBeCloseTo(10 - over, 10);
    expect(r.dir).toBe(-1);
  });

  it('下界反射：越界折回、方向翻回 +1', () => {
    // 起点 -9、步长 5 → 越界 4，折回 = -10 + 4 = -6
    const r = advanceSliderAnimation(-9, -1, 1000, 1, meta);
    expect(r.dir).toBe(1);
    expect(r.value).toBeCloseTo(-6, 10);
  });

  it('恰好到界不转向（下一帧越界才反射）；贴界浮点残差归精确边界', () => {
    const dt = (10 / rate(1)) * 1000; // 从 0 恰好走到 10 的 dt（ms）
    const r = advanceSliderAnimation(0, 1, dt, 1, meta);
    expect(r.value).toBe(10);
    expect(r.dir).toBe(1); // 站在上界仍向上，下一帧反射
    const next = advanceSliderAnimation(r.value, r.dir, 1000, 1, meta);
    expect(next.dir).toBe(-1);
    expect(next.value).toBeCloseTo(10 - rate(1) * 1000, 10);
  });

  it('大 dt 多次反射：一来一回后仍在范围内（贴界兜底，不死循环）', () => {
    const r = advanceSliderAnimation(0, 1, SLIDER_SWEEP_MS * 17, 2, meta); // 多个单程
    expect(r.value).toBeGreaterThanOrEqual(meta.min);
    expect(r.value).toBeLessThanOrEqual(meta.max);
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it('dt ≤ 0 / 量程非正：不产生位移（量程非正时贴界到唯一有效点）', () => {
    expect(advanceSliderAnimation(3, 1, 0, 1, meta)).toEqual({ value: 3, dir: 1 });
    expect(advanceSliderAnimation(3, 1, -50, 1, meta)).toEqual({ value: 3, dir: 1 });
    const flat = { min: 2, max: 2, step: 0.1 };
    expect(advanceSliderAnimation(5, 1, 100, 1, flat)).toEqual({ value: 2, dir: 1 });
  });
});

describe('constantDefaultValue / nextSliderSpeed（ZOO-197）', () => {
  it('预置名取教学惯用值、未知名 1', () => {
    expect(constantDefaultValue('g')).toBe(9.8);
    expect(constantDefaultValue('theta')).toBeCloseTo(Math.PI / 4, 12);
    expect(constantDefaultValue('omega')).toBe(1);
    expect(constantDefaultValue('v0')).toBe(1);
    expect(constantDefaultValue('a')).toBe(1);
    expect(constantDefaultValue('phi')).toBe(0);
    expect(constantDefaultValue('m')).toBe(1);
    expect(constantDefaultValue('k')).toBe(1);
  });

  it('速度档循环 0.5x → 1x → 2x → 0.5x；档位集恰为三档', () => {
    expect([...SLIDER_SPEEDS]).toEqual([0.5, 1, 2]);
    expect(nextSliderSpeed(0.5)).toBe(1);
    expect(nextSliderSpeed(1)).toBe(2);
    expect(nextSliderSpeed(2)).toBe(0.5);
  });
});

describe('parse missingConstants 一键建滑块符号集（ZOO-197）', () => {
  it('y=A·sin(ωx+φ) 未赋值：欠定引导附 [a, omega, phi]（x 占自变量位被剔除）', () => {
    const r = parseEquation('y=A·sin(ωx+φ)', zhT);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.missingConstants).toEqual(['a', 'omega', 'phi']);
    }
  });

  it('全赋值后错误消失：一键集合可恢复出图（显式函数）', () => {
    const constants = { a: 1, omega: 2, phi: 0.5 };
    const r = parseEquation('y=A·sin(ωx+φ)', zhT, constants);
    expect(r.kind).toBe('explicit');
    if (r.kind === 'explicit') expect(r.fn(0)).toBeCloseTo(Math.sin(0.5), 12);
  });

  it('部分赋值：剩余未赋值符号继续引导（已赋值键剔除）', () => {
    const r = parseEquation('y=A*sin(w*x+p)', zhT, { a: 2 });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.missingConstants).toEqual(['w', 'p']);
  });

  it('无 x 时保首个 ASCII 候选作自变量（y=z*w 只引导 w）', () => {
    const r = parseEquation('y=z*w', zhT);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.missingConstants).toEqual(['w']);
    // 一键绑 w 后 z 转自变量、方程合法
    expect(parseEquation('y=z*w', zhT, { w: 3 }).kind).toBe('explicit');
  });

  it('纯希腊缺赋值也引导（y=ω 一键绑后为常函数显式）', () => {
    const r = parseEquation('y=ω', zhT);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.missingConstants).toEqual(['omega']);
    const ok = parseEquation('y=ω', zhT, { omega: 2 });
    expect(ok.kind).toBe('explicit');
    if (ok.kind === 'explicit') expect(ok.fn(5)).toBe(2);
  });

  it('拼写错误 / 单变量合法输入不携带 missingConstants（非引导类错误零污染）', () => {
    const bad = parseEquation('y=foo', zhT);
    expect(bad.kind).toBe('error');
    if (bad.kind === 'error') expect(bad.missingConstants).toBeUndefined();
    const fine = parseEquation('y=4z', zhT);
    expect(fine.kind).toBe('explicit');
  });

  it('validateEquation 透传（编辑器消费同一份符号集）', () => {
    const r = validateEquation('y=A·sin(ωx+φ)', zhT);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.missingConstants).toEqual(['a', 'omega', 'phi']);
  });
});

describe('滑块元数据链路落元素（ZOO-197）', () => {
  const payload = (extra: Partial<EquationDraftPayload> = {}): EquationDraftPayload => {
    const outcome = validateEquation('y=A*sin(w*x+p)', zhT, { a: 1, w: 2, p: 0.5 });
    return { equation: 'y=A*sin(w*x+p)', outcome, constants: { a: 1, w: 2, p: 0.5 }, ...extra };
  };

  it('mathPlotFieldsFromPayload：自定义条目裁剪落键', () => {
    const fields = mathPlotFieldsFromPayload(
      payload({ constantSliders: { a: { min: -5, max: 5, step: 0.5 }, w: { min: 0, max: 8, step: 0.25 } } }),
    );
    expect(fields.constantSliders).toEqual({
      a: { min: -5, max: 5, step: 0.5 },
      w: { min: 0, max: 8, step: 0.25 },
    });
  });

  it('未绑定常量的键剔除（常量移除不留悬挂滑块条目）', () => {
    const fields = mathPlotFieldsFromPayload(
      payload({ constantSliders: { a: { min: 0, max: 1, step: 0.1 }, ghost: { min: -1, max: 1, step: 0.1 } } }),
    );
    expect(fields.constantSliders).toEqual({ a: { min: 0, max: 1, step: 0.1 } });
  });

  it('非法元数据逐项裁剪（min≥max 整体回默认）', () => {
    const fields = mathPlotFieldsFromPayload(
      payload({ constantSliders: { a: { min: 9, max: -9, step: 0 }, w: { min: 0, max: 4, step: 0.2 } } }),
    );
    expect(fields.constantSliders).toEqual({
      a: { ...DEFAULT_SLIDER, step: 0.1 },
      w: { min: 0, max: 4, step: 0.2 },
    });
  });

  it('空字典清洗为 undefined（显式清空不落键）；未携带不触碰（字段缺省）', () => {
    expect(mathPlotFieldsFromPayload(payload({ constantSliders: {} })).constantSliders).toBeUndefined();
    expect(mathPlotFieldsFromPayload(payload({ constantSliders: { ghost: { min: 0, max: 1, step: 0.1 } } })).constantSliders).toBeUndefined();
    expect('constantSliders' in mathPlotFieldsFromPayload(payload())).toBe(false);
  });

  it('createMathPlotElement：非空元数据落元素、常量集为空不落键（旧文档零迁移）', () => {
    const el = createMathPlotElement(payload({ constantSliders: { a: { min: -3, max: 3, step: 0.3 } } }), {
      centerX: 0,
      centerY: 0,
    });
    expect(el.constantSliders).toEqual({ a: { min: -3, max: 3, step: 0.3 } });
    expect(el.constants).toEqual({ a: 1, w: 2, p: 0.5 });

    const plain = validateEquation('y=sin(x)', zhT);
    const el2 = createMathPlotElement({ equation: 'y=sin(x)', outcome: plain }, { centerX: 0, centerY: 0 });
    expect('constantSliders' in el2).toBe(false);
    expect('constants' in el2).toBe(false);
  });

  it('cleanSliderMap：常量集为空时恒 undefined', () => {
    expect(cleanSliderMap({ a: { min: 0, max: 1, step: 0.1 } }, undefined)).toBeUndefined();
    expect(cleanSliderMap({ a: { min: 0, max: 1, step: 0.1 } }, {})).toBeUndefined();
    expect(cleanSliderMap(undefined, { a: 1 })).toBeUndefined();
  });
});
