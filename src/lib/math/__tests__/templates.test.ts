import { describe, it, expect } from 'vitest';
import {
  EQUATION_TEMPLATES,
  TEMPLATE_GROUPS,
  groupTemplates,
  templateGroupNameKey,
  templateNameKey,
} from '../templates';
import zhCN from '../../../../messages/zh-CN.json';
import enUS from '../../../../messages/en-US.json';

/** catalog 按点路径取叶子值 */
function lookup(catalog: unknown, key: string): unknown {
  let node = catalog;
  for (const seg of key.split('.')) node = (node as Record<string, unknown>)[seg];
  return node;
}

/** ZOO-164：模板分组数据完整性（分组渲染的前提）；ZOO-176：id 与资源键对齐 */
describe('模板分组（TEMPLATE_GROUPS / groupTemplates）', () => {
  it('19 个模板每个恰好归属一组（无遗漏 / 无重复 / 无未注册组）', () => {
    const grouped = groupTemplates().flatMap((g) => g.templates.map((t) => t.id));
    expect(grouped).toHaveLength(EQUATION_TEMPLATES.length);
    expect(new Set(grouped).size).toBe(EQUATION_TEMPLATES.length);
    // 双向对齐：分组收集到的 id 集合 === 平铺模板 id 集合
    expect(new Set(grouped)).toEqual(new Set(EQUATION_TEMPLATES.map((t) => t.id)));
  });

  it('组 id 唯一（折叠状态键无冲突）', () => {
    const ids = TEMPLATE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('分组解析保留模板对象原引用（插入路径与平铺版一致）', () => {
    const byId = new Map(EQUATION_TEMPLATES.map((t) => [t.id, t]));
    for (const group of groupTemplates()) {
      for (const t of group.templates) {
        expect(t).toBe(byId.get(t.id));
        expect(t.equation).toBe(byId.get(t.id)?.equation);
      }
    }
  });

  it('组内模板数与组头计数一致（渲染的数量角标可信）', () => {
    for (const group of groupTemplates()) {
      expect(group.templates).toHaveLength(group.templateIds.length);
    }
  });

  it('首组为基本函数（默认展开组的确定性）', () => {
    expect(TEMPLATE_GROUPS[0]).toMatchObject({ id: 'basic' });
  });
});

describe('i18n 资源键对齐（ZOO-176：新增语言只需翻译文件）', () => {
  it('每个模板 / 分组 / 符号在两份 catalog 中都有非空显示名', () => {
    const keys = [
      ...EQUATION_TEMPLATES.map((t) => templateNameKey(t.id)),
      ...TEMPLATE_GROUPS.map((g) => templateGroupNameKey(g.id)),
    ];
    for (const key of keys) {
      for (const catalog of [zhCN, enUS]) {
        const value = lookup(catalog, key);
        expect(typeof value === 'string' && value.length > 0, `${key}`).toBe(true);
      }
    }
  });
});
