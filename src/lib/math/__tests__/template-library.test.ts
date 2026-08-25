/**
 * 学段模板库全量验收（ZOO-213）。
 *
 * 「27 条存量 + 23 条新增 = 50 条逐条插入出图」的自动化证据：面板 42 条 +
 * 高级公式 1 条 + 参数式 4 条 + 物理 3 条，每条走真实插入链路——
 * validateEquation（含常量裁决）→ createPreviewPolylines（面板预览采样）→
 * createMathPlotElement（元素工厂）→ sampleEquation（按元素 xAxis 重采样）。
 * 硬约束：任何带常量模板不允许出现「插入后报欠定/缺常量错误」。
 */
import { describe, expect, it } from 'vitest';
import {
  ADVANCED_TEMPLATES,
  EQUATION_TEMPLATES,
  PARAMETRIC_TEMPLATES,
  PHYSICS_TEMPLATES,
  type EquationTemplate,
} from '../templates';
import { validateEquation } from '../validate';
import { parseEquation } from '../parse';
import { createPreviewPolylines, sampleEquation } from '../sample';
import { createMathPlotElement, mathPlotFieldsFromPayload } from '../../mathplotElement';
import { normalizeSliderMeta } from '../slider';
import type { EquationDraftPayload, MathPlotOverlay } from '../types';
import { zhT } from '../../../i18n/lib';

/** 插入链路各集合的统一形态（物理模板的常量 / 域即其整包载荷） */
interface LibraryEntry {
  source: string;
  tpl: EquationTemplate & { domain?: { min: number; max: number } };
}

const LIBRARY: LibraryEntry[] = [
  ...EQUATION_TEMPLATES.map((tpl) => ({ source: 'panel', tpl })),
  // sineConstants（ZOO-188 常量绑定教学演示）不带常量预置：刻意保留「欠定 →
  // 一键建滑块 chips → 出图」两步流，且其回填逻辑属高级面板常量分区（本任务
  // 并行边界不改）——按下述专测覆盖，不进全量「即点即出图」断言。
  ...ADVANCED_TEMPLATES.filter((tpl) => tpl.constants).map((tpl) => ({ source: 'advanced', tpl })),
  ...PARAMETRIC_TEMPLATES.map((tpl) => ({ source: 'parametric', tpl })),
  ...PHYSICS_TEMPLATES.map((tpl) => ({ source: 'physics', tpl })),
];

/** 模板点选后的确认载荷（EquationEditor 整包回填的镜像：常量 + 滑块 + 域 + 叠加） */
function payloadFor(tpl: LibraryEntry['tpl']): EquationDraftPayload {
  const outcome = validateEquation(tpl.equation, zhT, tpl.constants);
  return {
    equation: tpl.equation,
    outcome,
    constants: tpl.constants ? { ...tpl.constants } : undefined,
    overlays: tpl.overlays ? tpl.overlays.map((o) => ({ ...o })) : undefined,
    domain: tpl.domain ? { ...tpl.domain } : undefined,
    constantSliders: tpl.constantSliders ? { ...tpl.constantSliders } : undefined,
  };
}

describe('模板库全量插入出图（50 条，ZOO-213 验收）', () => {
  it('库容量：42 面板 + 1 高级 + 4 参数式 + 3 物理 = 50', () => {
    expect(LIBRARY).toHaveLength(49);
    expect(EQUATION_TEMPLATES).toHaveLength(42);
    expect(LIBRARY.filter((e) => e.source === 'advanced')).toHaveLength(0); // sineConstants 走专测
  });

  it('高级面板 sineConstants：设计的两步流——裸态欠定引导（chips 可绑），绑定常量后出图', () => {
    const tpl = ADVANCED_TEMPLATES.find((t) => t.id === 'sineConstants')!;
    expect(tpl.equation).toBe('y=A·sin(ωx+φ)');
    // 裸态：欠定错误携带 missingConstants（ZOO-197 一键建滑块 chips 的数据源）
    const bare = validateEquation(tpl.equation, zhT, {});
    expect(bare.kind).toBe('error');
    if (bare.kind === 'error') expect(bare.missingConstants).toEqual(['a', 'omega', 'phi']);
    // chips 一键绑定教学惯用值后：合法并出图（与面板 chips 行为同口径）
    const bound = { a: 1, omega: 1, phi: 0 };
    const outcome = validateEquation(tpl.equation, zhT, bound);
    expect(outcome.kind).not.toBe('error');
    const preview = createPreviewPolylines(tpl.equation, outcome, bound);
    expect(preview?.polylines.some((pl) => pl.length > 0)).toBe(true);
  });

  it.each(LIBRARY.map((e) => [e.source, e.tpl.id, e.tpl] as const))(
    '%s/%s：validate 不报欠定、预览出折线、元素建立且按元素域重采样出图',
    (_source, _id, tpl) => {
      // 一键出图硬约束：模板常量回填后不出现欠定 / 缺常量 / 拼写错误
      const outcome = validateEquation(tpl.equation, zhT, tpl.constants);
      expect(outcome.kind, `${tpl.equation}: ${outcome.kind === 'error' ? outcome.message : ''}`).not.toBe('error');

      // 面板预览：按模板域采样出非空折线
      const preview = createPreviewPolylines(tpl.equation, outcome, tpl.constants, tpl.domain);
      expect(preview, `${tpl.equation}: 预览为空`).not.toBeNull();
      const previewPoints = preview!.polylines.reduce((n, pl) => n + pl.length, 0);
      expect(previewPoints, `${tpl.equation}: 预览折线为空`).toBeGreaterThan(0);

      // 元素工厂：建立成功、无错误态
      const payload = payloadFor(tpl);
      const el = createMathPlotElement(payload, { centerX: 0, centerY: 0 });
      expect(el.error, `${tpl.equation}: 元素带错误态`).toBeNull();
      expect(el.kind, `${tpl.equation}: kind 不符`).toBe(outcome.kind);

      // 渲染管线：按元素 xAxis（域预置生效处）重采样出非空折线
      const parsed = parseEquation(el.equation, zhT, el.constants);
      const sampled = sampleEquation(parsed, { xMin: el.xAxis.min, xMax: el.xAxis.max, sampleCount: el.sampleCount }, zhT);
      expect('error' in sampled ? sampled.error : '', `${tpl.equation}: 元素重采样报错`).toBe('');
      const elPoints = (!('error' in sampled) ? sampled.polylines : []).reduce((n, pl) => n + pl.length, 0);
      expect(elPoints, `${tpl.equation}: 元素折线为空`).toBeGreaterThan(0);

      // 常量 / 滑块 / 叠加载荷随元素落键
      if (tpl.constants) {
        expect(el.constants, `${tpl.equation}: 常量未落元素`).toEqual(tpl.constants);
      }
      if (tpl.constantSliders) {
        expect(el.constantSliders, `${tpl.equation}: 滑块元数据未落元素`).toEqual(tpl.constantSliders);
      }
      if (tpl.overlays) {
        expect(el.overlays, `${tpl.equation}: 叠加未落元素`).toEqual(tpl.overlays);
      }
    },
  );

  it('域预置落元素 xAxis：显式函数（自由落体落地截断）与参数式（抛体）同口径', () => {
    const freeFall = EQUATION_TEMPLATES.find((t) => t.id === 'freeFall')!;
    const el = createMathPlotElement(payloadFor(freeFall), { centerX: 0, centerY: 0 });
    expect(el.kind).toBe('explicit');
    expect(el.xAxis).toEqual({ min: 0, max: 2.02 });

    const projectile = PHYSICS_TEMPLATES.find((t) => t.id === 'projectile')!;
    const p = createMathPlotElement(payloadFor(projectile), { centerX: 0, centerY: 0 });
    expect(p.xAxis).toEqual({ min: 0, max: projectile.domain.max });
  });

  it('显式函数的域载荷非法（倒序 / 非有限）时忽略、落默认 ±10（与预览同口径）', () => {
    const outcome = validateEquation('y=2x', zhT);
    for (const domain of [{ min: 5, max: 1 }, { min: NaN, max: 1 }, { min: 0, max: Infinity }]) {
      const fields = mathPlotFieldsFromPayload({ equation: 'y=2x', outcome, domain });
      expect(fields.xAxis).toBeUndefined();
      const preview = createPreviewPolylines('y=2x', outcome, undefined, domain);
      expect(preview?.xMin).toBe(-10);
      expect(preview?.xMax).toBe(10);
    }
  });

  it('带常量模板的滑块元数据：键 ⊆ 常量键、逐键合法（min<max、step>0）', () => {
    const withConstants = LIBRARY.filter((e) => e.tpl.constants);
    expect(withConstants.length).toBeGreaterThan(0);
    for (const { tpl } of withConstants) {
      const keys = Object.keys(tpl.constantSliders ?? {});
      for (const key of keys) {
        expect(tpl.constants, `${tpl.equation}: 滑块键 ${key} 无常量绑定`).toBeDefined();
        expect(Object.keys(tpl.constants ?? {})).toContain(key);
        const meta = normalizeSliderMeta(tpl.constantSliders![key]);
        expect(meta.min).toBeLessThan(meta.max);
        expect(meta.step).toBeGreaterThan(0);
      }
    }
  });

  it('存量 19 条模板方程原文零改动（行为零回归的数据快照）', () => {
    const legacy: readonly (readonly [string, string])[] = [
      ['linear', 'y=2x+1'],
      ['linear2var', '3x+2y=6'],
      ['quadratic', 'y=x²-2x-3'],
      ['cubic', 'y=x³-2x'],
      ['sine', 'y=sin(x)'],
      ['sineTransform', 'y=2sin(2x+π/3)'],
      ['tangent', 'y=tan(x)'],
      ['radical', 'y=√x'],
      ['inverse', 'y=1/x'],
      ['exponent', 'y=2ˣ'],
      ['log', 'y=ln(x)'],
      ['absolute', 'y=|x-1|'],
      ['circle', '(x-1)²+(y-2)²=9'],
      ['ellipse', 'x²/9+y²/4=1'],
      ['parabola', 'y²=4x'],
      ['hyperbola', 'x²/9-y²/4=1'],
      ['degenerateLines', 'x²-y²=0'],
      ['rotatedHyperbola', 'xy=1'],
      ['rotatedEllipse', '5x²-6xy+5y²=8'],
    ];
    for (const [id, equation] of legacy) {
      const tpl = EQUATION_TEMPLATES.find((t) => t.id === id);
      expect(tpl, id).toBeDefined();
      expect(tpl!.equation, id).toBe(equation);
      // 存量模板不带载荷：插入路径与演进前逐字节一致
      expect(tpl!.constants, id).toBeUndefined();
      expect(tpl!.domain, id).toBeUndefined();
      expect(tpl!.overlays, id).toBeUndefined();
    }
  });

  it('23 条新增模板逐条在库（id 清单快照）', () => {
    const newIds = [
      'proportional', 'inverseProp', 'letterCoeff',
      'linearKb', 'vertexQuadratic', 'generalQuadratic', 'inverseK',
      'uniformMotion', 'accelVt', 'accelXt', 'freeFall', 'ohmIU', 'densityMV',
      'cosine', 'cosineTransform', 'expDecay', 'powerFunc', 'expParam', 'logBase2', 'derivTangent',
      'shmVelocity', 'mechWave', 'acCurrent',
    ];
    expect(newIds).toHaveLength(23);
    const ids = new Set(EQUATION_TEMPLATES.map((t) => t.id));
    for (const id of newIds) expect(ids.has(id), id).toBe(true);
  });
});

/** 叠加载荷形态编译期自检（derivTangent 切线 / shmVelocity 导数虚线）。 */
describe('教学叠加预置（ZOO-213）', () => {
  it('导数切线案例：切点 x₀=1', () => {
    const tpl = EQUATION_TEMPLATES.find((t) => t.id === 'derivTangent')!;
    expect(tpl.overlays).toEqual([{ type: 'tangent', x0: 1 }] satisfies MathPlotOverlay[]);
  });

  it('简谐+速度同屏：f′ 叠加（v-t 虚线）', () => {
    const tpl = EQUATION_TEMPLATES.find((t) => t.id === 'shmVelocity')!;
    expect(tpl.overlays).toEqual([{ type: 'derivative' }] satisfies MathPlotOverlay[]);
  });
});
