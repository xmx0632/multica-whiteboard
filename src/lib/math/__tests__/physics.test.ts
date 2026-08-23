import { describe, expect, it } from 'vitest';
import { trajectoryMarks } from '../physics';
import { PHYSICS_CONSTANT_UNITS } from '../physics';
import { PHYSICS_TEMPLATES, physicsTemplateNameKey } from '../templates';
import { parseConstantValue } from '../normalize';
import { parseEquation } from '../parse';
import { validateEquation } from '../validate';
import { createPreviewPolylines } from '../sample';
import { drawGraphCore, resolvePlotRender, formatOverlayNumber, type PlotFrame, type PlotSpec } from '../plot';
import { advancedFormulaState } from '../../advancedFormula';
import { convergeEquationCommit, createMathPlotElement, mathPlotFieldsFromPayload } from '../../mathplotElement';
import { exportToSvg } from '../../export';
import { zhT } from '../../../i18n/lib';
import type { MathPlotElement } from '../../types';
import type { EquationDraftPayload, Polyline } from '../types';

/**
 * ZOO-192 T5 物理模板包编排单测：trajectoryMarks 与解析解对照（PoC 验收基准
 * v₀=20、θ=30°、g=9.8 → T≈2.04s、R≈35.35、H≈5.1）、渲染管线标注联动、
 * 模板数据完整性（方程 + 常量 + 域预置）、元素工厂 / commit 收敛、canvas 与
 * SVG 导出同步、常量值单位剥离（不做量纲运算）。
 */

const frame: PlotFrame = { width: 480, height: 360 };

/** PoC 基准抛体（模板预置口径）。 */
const PROJECTILE = PHYSICS_TEMPLATES.find((tpl) => tpl.id === 'projectile')!;
/** 落地时间 T = 2v₀sinθ/g ≈ 2.04s。 */
const T_LAND = (2 * 20 * Math.sin(Math.PI / 6)) / 9.8;

function projectileSpec(constants: Record<string, number>, domain?: { min: number; max: number }, overlays?: PlotSpec['overlays']): PlotSpec {
  return {
    equation: 'x=v₀·cos(θ)·t,y=v₀·sin(θ)·t-0.5·g·t²',
    kind: 'parametric',
    xAxis: domain ?? { ...PROJECTILE.domain },
    equalRatio: true,
    sampleCount: 320,
    constants,
    ...(overlays !== undefined ? { overlays } : {}),
  };
}

const bboxOf = (polylines: Polyline[]) => {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pl of polylines) {
    for (const p of pl) {
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
  }
  return { xMin, xMax, yMin, yMax };
};

describe('trajectoryMarks：抛体标注 vs 解析解（PoC 验收基准）', () => {
  const fx = (t: number) => 20 * Math.cos(Math.PI / 6) * t;
  const fy = (t: number) => 20 * Math.sin(Math.PI / 6) * t - 0.5 * 9.8 * t * t;

  it('v₀=20、θ=30°、g=9.8：H≈5.1、R≈35.35（解析解 v²sin²θ/2g 与 v²sin2θ/g）', () => {
    const marks = trajectoryMarks(fx, fy, { min: 0, max: T_LAND });
    expect(marks).not.toBeNull();
    if (!marks) return;
    expect(marks.peak.height).toBeCloseTo((20 * 20 * 0.25) / (2 * 9.8), 6); // 5.102
    expect(marks.landing?.range).toBeCloseTo((20 * 20 * Math.sin(Math.PI / 3)) / 9.8, 6); // 35.353
    expect(marks.launch).toEqual({ x: 0, y: 0 });
  });

  it('峰值点横坐标 = 射程一半（对称轨迹）；落地时刻 T≈2.04s 处 y 回到抛出高度', () => {
    const marks = trajectoryMarks(fx, fy, { min: 0, max: T_LAND })!;
    expect(marks.peak.x).toBeCloseTo(marks.landing!.range / 2, 6);
    expect(marks.peak.y).toBeCloseTo(marks.peak.height, 12); // 自地面抛出：峰高即绝对高度
    expect(marks.landing!.y).toBeCloseTo(0, 12);
  });

  it('域略宽于落地时间（轨迹入地）：标注仍取 y=0 越零点，不取域端', () => {
    const marks = trajectoryMarks(fx, fy, { min: 0, max: T_LAND * 1.3 })!;
    expect(marks.landing!.range).toBeCloseTo((400 * Math.sin(Math.PI / 3)) / 9.8, 6);
  });

  it('常量改值联动语义：v₀=15 在域内落地（R≈19.88）、v₀=30 截断半空（无 R 标注）', () => {
    const mk = (v0: number) => {
      const fxi = (t: number) => v0 * Math.cos(Math.PI / 6) * t;
      const fyi = (t: number) => v0 * Math.sin(Math.PI / 6) * t - 4.9 * t * t;
      return trajectoryMarks(fxi, fyi, { min: 0, max: T_LAND });
    };
    const slow = mk(15)!;
    expect(slow.landing).toBeDefined();
    expect(slow.landing!.range).toBeCloseTo((225 * Math.sin(Math.PI / 3)) / 9.8, 6);
    const fast = mk(30)!;
    expect(fast.peak.height).toBeCloseTo(225 / 19.6, 6); // H = (30·0.5)²/(2g)
    expect(fast.landing).toBeUndefined(); // 弧线截断在半空——不标 R
  });

  it('非抛体形返回 null：水平抛出（θ=0 无上升）、上升段被截断（峰贴域端）、非法域', () => {
    const horizontal = trajectoryMarks((t) => 20 * t, (t) => -4.9 * t * t, { min: 0, max: 2 });
    expect(horizontal).toBeNull();
    const cutAscent = trajectoryMarks(fx, fy, { min: 0, max: 1 }); // 峰值 t≈1.02 在域外
    expect(cutAscent).toBeNull();
    expect(trajectoryMarks(fx, fy, { min: 2, max: 2 })).toBeNull();
    expect(trajectoryMarks(fx, () => NaN, { min: 0, max: 1 })).toBeNull();
  });
});

describe('物理模板数据（PHYSICS_TEMPLATES）', () => {
  it('三件套齐全；抛体 t 域预置到落地时间 T≈2.04s 且带标注；其余不带', () => {
    expect(PHYSICS_TEMPLATES.map((tpl) => tpl.id)).toEqual(['projectile', 'shm', 'circular']);
    expect(PROJECTILE.domain).toEqual({ min: 0, max: T_LAND });
    expect(T_LAND).toBeCloseTo(2.04, 2);
    expect(PROJECTILE.marks).toBe(true);
    expect(PHYSICS_TEMPLATES.filter((tpl) => tpl.marks)).toHaveLength(1);
  });

  it('抛体：常量预置配方程解析为 parametric，t 为参数', () => {
    const r = parseEquation(PROJECTILE.equation, zhT, PROJECTILE.constants);
    expect(r.kind).toBe('parametric');
    if (r.kind !== 'parametric') return;
    expect(r.fx(0)).toBeCloseTo(0, 12);
    expect(r.fy(0)).toBeCloseTo(0, 12);
    expect(r.variable).toBeUndefined(); // 参数恰为 t
  });

  it('简谐：x(t)=A·cos(ωt+φ) 走显式渲染（零新渲染），自变量 t、常量注入求值', () => {
    const shm = PHYSICS_TEMPLATES.find((tpl) => tpl.id === 'shm')!;
    const r = parseEquation(shm.equation, zhT, shm.constants);
    expect(r.kind).toBe('explicit');
    if (r.kind !== 'explicit') return;
    expect(r.variable).toBe('t');
    expect(r.fn(0)).toBeCloseTo(2, 12); // A·cos(0) = 2
    expect(r.fn(Math.PI)).toBeCloseTo(-2, 12);
    // 未赋值常量 → 引导常量区（T1 口径不变）
    const unbound = validateEquation(shm.equation, zhT, {});
    expect(unbound.kind).toBe('error');
  });

  it('圆周：x=A·cos(ωt),y=A·sin(ωt) 解析为 parametric（半径 A=2 整圆）', () => {
    const circular = PHYSICS_TEMPLATES.find((tpl) => tpl.id === 'circular')!;
    const r = parseEquation(circular.equation, zhT, circular.constants);
    expect(r.kind).toBe('parametric');
    if (r.kind !== 'parametric') return;
    expect(r.fx(0)).toBeCloseTo(2, 12);
    expect(r.fy(Math.PI / 2)).toBeCloseTo(2, 12);
    const sampled = createPreviewPolylines(circular.equation, { kind: 'parametric' }, circular.constants, circular.domain);
    expect(sampled).not.toBeNull();
    const bbox = bboxOf(sampled!.polylines);
    // 320 点网格量化：极值点未必被采样命中，容差对齐网格步长（2π/319 ≈ 0.02）
    expect(bbox.xMax).toBeCloseTo(2, 3);
    expect(bbox.yMin).toBeCloseTo(-2, 3);
  });

  it('模板名资源键走 phys.* 独立命名空间', () => {
    expect(physicsTemplateNameKey('projectile')).toBe('phys.tplProjectile');
    expect(zhT('phys.tplProjectile')).toBe('抛体运动');
  });
});

describe('渲染管线：physics 叠加条目（resolvePlotRender）', () => {
  it('抛体 + physics 条目：产出 overlays.physics，数值与解析解一致', () => {
    const r = resolvePlotRender(projectileSpec(PROJECTILE.constants, undefined, [{ type: 'physics' }]), frame, {});
    expect(r.error).toBeUndefined();
    const marks = r.overlays?.physics;
    expect(marks).toBeDefined();
    if (!marks) return;
    expect(marks.peak.height).toBeCloseTo(5.102, 3);
    expect(marks.landing?.range).toBeCloseTo((400 * Math.sin(Math.PI / 3)) / 9.8, 3); // 35.348 → 显示 35.35
    expect(formatOverlayNumber(marks.peak.height)).toBe('5.1');
    expect(formatOverlayNumber(marks.landing!.range)).toBe('35.35');
  });

  it('常量改值实时联动：g 从 9.8 → 12.6，H/R 随渲染签名失效重算', () => {
    const r1 = resolvePlotRender(projectileSpec({ v0: 20, theta: Math.PI / 6, g: 9.8 }, undefined, [{ type: 'physics' }]), frame, {});
    const r2 = resolvePlotRender(projectileSpec({ v0: 20, theta: Math.PI / 6, g: 12.6 }, { min: 0, max: T_LAND * 9.8 / 12.6 }, [{ type: 'physics' }]), frame, {});
    expect(r1.overlays?.physics?.peak.height).toBeCloseTo(5.102, 3);
    expect(r2.overlays?.physics?.peak.height).toBeCloseTo((400 * 0.25) / (2 * 12.6), 3);
    expect(r1.overlays?.physics?.peak.height).not.toBeCloseTo(r2.overlays?.physics?.peak.height ?? 0, 3);
  });

  it('physics 条目对显式方程（简谐）静默忽略、数据保留：无 overlays.physics 产出', () => {
    const shm = PHYSICS_TEMPLATES.find((tpl) => tpl.id === 'shm')!;
    const r = resolvePlotRender(
      {
        equation: shm.equation,
        kind: 'explicit',
        xAxis: { ...shm.domain },
        equalRatio: false,
        sampleCount: 320,
        constants: shm.constants,
        overlays: [{ type: 'physics' }],
      },
      frame,
      {},
    );
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    expect(r.overlays).toBeUndefined();
  });

  it('无 physics 条目的参数式元素零变化：overlays 不产出（既有路径不受扰）', () => {
    const r = resolvePlotRender(projectileSpec(PROJECTILE.constants), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.overlays).toBeUndefined();
  });
});

describe('canvas 绘制与 SVG 导出同步', () => {
  function createMockCtx() {
    const calls: { op: string; args: unknown[] }[] = [];
    const ctx = new Proxy(
      { calls },
      {
        get(target: { calls: { op: string; args: unknown[] }[] }, prop: string) {
          if (prop === 'calls') return target.calls;
          if (prop === 'measureText') return () => ({ width: 10 });
          return (...args: unknown[]) => {
            target.calls.push({ op: prop, args });
          };
        },
        set(target: { calls: { op: string; args: unknown[] }[] }, prop: string, value: unknown) {
          target.calls.push({ op: `set:${prop}`, args: [value] });
          return true;
        },
      },
    );
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  function makeElement(overlays?: MathPlotElement['overlays']): MathPlotElement {
    return {
      id: 'mp-phys-1',
      type: 'mathPlot',
      x: 0,
      y: 0,
      width: 480,
      height: 360,
      strokeColor: '#3B82F6',
      strokeWidth: 2,
      opacity: 1,
      equation: PROJECTILE.equation,
      kind: 'parametric',
      error: null,
      xAxis: { ...PROJECTILE.domain },
      equalRatio: true,
      sampleCount: 320,
      showAxis: true,
      showGrid: true,
      showLabel: true,
      constants: { ...PROJECTILE.constants },
      ...(overlays ? { overlays } : {}),
    };
  }

  it('canvas：紫 #A855F7 标注层——导引虚线 [4,4] / 标注点 arc / H·R 文字', () => {
    const r = resolvePlotRender(projectileSpec(PROJECTILE.constants, undefined, [{ type: 'physics' }]), frame, {});
    const { ctx, calls } = createMockCtx();
    drawGraphCore(ctx, {
      width: 480,
      height: 360,
      view: r.view,
      polylines: r.polylines,
      path2d: null,
      style: { strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1 },
      showGrid: false,
      showAxis: false,
      overlays: r.overlays,
    });
    expect(calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.args[0])).toContain('#A855F7');
    expect(calls.some((c) => c.op === 'setLineDash' && JSON.stringify(c.args[0]) === '[4,4]')).toBe(true);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('H = 5.1');
    expect(texts).toContain('R = 35.35');
    expect(calls.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(2); // 峰值 + 落地标记
  });

  it('SVG：同一套数据与配色——#A855F7 导引虚线 / H = 5.1 / R = 35.35 文字', () => {
    const svg = exportToSvg([makeElement([{ type: 'physics' }])]);
    expect(svg).toContain('#A855F7');
    expect(svg).toContain('>H = 5.1</text>');
    expect(svg).toContain('>R = 35.35</text>');
    expect(svg).toMatch(/stroke-dasharray="4,4"/);
  });

  it('无 physics 条目：SVG / canvas 均无物理标注层（既有导出零变化）', () => {
    const svg = exportToSvg([makeElement()]);
    expect(svg).not.toContain('#A855F7');
    expect(svg).not.toContain('H = ');
    expect(svg).not.toContain('R = ');
  });
});

describe('元素工厂与 commit 收敛', () => {
  it('createMathPlotElement：抛体模板载荷 → kind parametric、t 域预置、physics 条目与常量落元素', () => {
    const outcome = validateEquation(PROJECTILE.equation, zhT, PROJECTILE.constants);
    expect(outcome.kind).toBe('parametric');
    const payload: EquationDraftPayload = {
      equation: PROJECTILE.equation,
      outcome,
      constants: { ...PROJECTILE.constants },
      overlays: [{ type: 'physics' }],
      domain: { ...PROJECTILE.domain },
    };
    const el = createMathPlotElement(payload, { centerX: 0, centerY: 0 });
    expect(el.kind).toBe('parametric');
    expect(el.xAxis).toEqual({ min: 0, max: T_LAND });
    expect(el.overlays).toEqual([{ type: 'physics' }]);
    expect(el.constants).toEqual(PROJECTILE.constants);
    expect(el.equalRatio).toBe(true);
  });

  it('原位替换（方程微调）：载荷未携带域时 fallback 保持元素现 t 域，不重置默认', () => {
    const outcome = validateEquation(PROJECTILE.equation, zhT, PROJECTILE.constants);
    const fields = mathPlotFieldsFromPayload(
      { equation: PROJECTILE.equation, outcome, constants: { ...PROJECTILE.constants }, overlays: [{ type: 'physics' }] },
      { min: 0, max: T_LAND },
    );
    expect(fields.xAxis).toEqual({ min: 0, max: T_LAND });
  });

  it('convergeEquationCommit：显式元素切到参数式时 fallback 域生效（模板预置域不被默认 [0,2π] 覆盖）', () => {
    const withFallback = convergeEquationCommit(PROJECTILE.equation, zhT, PROJECTILE.constants, { min: 0, max: T_LAND });
    expect(withFallback.fields?.xAxis).toEqual({ min: 0, max: T_LAND });
    const withoutFallback = convergeEquationCommit(PROJECTILE.equation, zhT, PROJECTILE.constants);
    expect(withoutFallback.fields?.xAxis).toEqual({ min: 0, max: Math.PI * 2 });
  });

  it('advancedFormulaState：physics 条目点亮「公式设置」入口并计数', () => {
    const state = advancedFormulaState({ kind: 'parametric', overlays: [{ type: 'physics' }] });
    expect(state.visible).toBe(true);
    expect(state.overlayCount).toBe(1);
  });
});

describe('预览采样：草稿 t/θ 域透传（ZOO-192）', () => {
  it('抛体预览按草稿域 [0,T] 采样——数据 bbox 至落地点 x≈R；缺省回落 [0,2π]', () => {
    const outcome = validateEquation(PROJECTILE.equation, zhT, PROJECTILE.constants);
    expect(outcome.kind).toBe('parametric');
    const withDomain = createPreviewPolylines(PROJECTILE.equation, outcome, PROJECTILE.constants, { min: 0, max: T_LAND });
    // x 随 t 单调：bbox 右端 = 末采样点（恰为域端 T）→ 解析落地点 x = v₀cosθ·T
    expect(bboxOf(withDomain!.polylines).xMax).toBeCloseTo(20 * Math.cos(Math.PI / 6) * T_LAND, 6);
    const fallback = createPreviewPolylines(PROJECTILE.equation, outcome, PROJECTILE.constants);
    expect(bboxOf(fallback!.polylines).xMax).toBeCloseTo(20 * Math.cos(Math.PI / 6) * Math.PI * 2, 6);
    // 非法草稿域（倒序）回落默认，不报错
    const invalid = createPreviewPolylines(PROJECTILE.equation, outcome, PROJECTILE.constants, { min: 2, max: 2 });
    expect(invalid).not.toBeNull();
  });
});

describe('常量值单位剥离（parseConstantValue，不做量纲运算）', () => {
  it('数值 + 单位后缀：值与单位分离；单位字符串仅回显、不参与运算', () => {
    expect(parseConstantValue('9.8 m/s²')).toEqual({ value: 9.8, unit: 'm/s²' });
    expect(parseConstantValue('20m/s')).toEqual({ value: 20, unit: 'm/s' });
    expect(parseConstantValue('0.52rad')).toEqual({ value: 0.52, unit: 'rad' });
    expect(parseConstantValue('20')).toEqual({ value: 20, unit: '' });
    expect(parseConstantValue('-5.1 m')).toEqual({ value: -5.1, unit: 'm' });
    expect(parseConstantValue('3e2 deg')).toEqual({ value: 300, unit: 'deg' });
  });

  it('无数值前缀返回 null（面板禁用添加）', () => {
    expect(parseConstantValue('abc')).toBeNull();
    expect(parseConstantValue('')).toBeNull();
    expect(parseConstantValue('m/s²')).toBeNull();
  });

  it('物理常量单位表覆盖 T1 预置槽（g/v₀/θ/ω/A/φ）', () => {
    for (const key of ['g', 'v0', 'theta', 'omega', 'a', 'phi']) {
      expect(PHYSICS_CONSTANT_UNITS[key]).toBeTruthy();
    }
    expect(PHYSICS_CONSTANT_UNITS.g).toBe('m/s²');
  });
});
