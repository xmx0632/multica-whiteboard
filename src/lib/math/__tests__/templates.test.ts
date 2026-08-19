import { describe, it, expect } from 'vitest';
import { EQUATION_TEMPLATES, TEMPLATE_GROUPS, groupTemplates } from '../templates';

/** ZOO-164：模板分组数据完整性（分组渲染的前提） */
describe('模板分组（TEMPLATE_GROUPS / groupTemplates）', () => {
  it('19 个模板每个恰好归属一组（无遗漏 / 无重复 / 无未注册组）', () => {
    const grouped = groupTemplates().flatMap((g) => g.templates.map((t) => t.name));
    expect(grouped).toHaveLength(EQUATION_TEMPLATES.length);
    expect(new Set(grouped).size).toBe(EQUATION_TEMPLATES.length);
    // 双向对齐：分组收集到的名字集合 === 平铺模板名字集合
    expect(new Set(grouped)).toEqual(new Set(EQUATION_TEMPLATES.map((t) => t.name)));
  });

  it('组 id 唯一（折叠状态键无冲突）', () => {
    const ids = TEMPLATE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('分组解析保留模板对象原引用（插入路径与平铺版一致）', () => {
    const byName = new Map(EQUATION_TEMPLATES.map((t) => [t.name, t]));
    for (const group of groupTemplates()) {
      for (const t of group.templates) {
        expect(t).toBe(byName.get(t.name));
        expect(t.equation).toBe(byName.get(t.name)?.equation);
      }
    }
  });

  it('组内模板数与组头计数一致（渲染的数量角标可信）', () => {
    for (const group of groupTemplates()) {
      expect(group.templates).toHaveLength(group.templateNames.length);
    }
  });

  it('首组为基本函数（默认展开组的确定性）', () => {
    expect(TEMPLATE_GROUPS[0]).toMatchObject({ id: 'basic', name: '基本函数' });
  });
});
