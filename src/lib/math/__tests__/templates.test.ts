import { describe, it, expect } from 'vitest';
import {
  EQUATION_TEMPLATES,
  TEMPLATE_GROUPS,
  COMMON_GROUP_ID,
  groupTemplates,
  templateGroupNameKey,
  templateNameKey,
} from '../templates';
import zhCN from '../../../../messages/zh-CN.json';
import enUS from '../../../../messages/en-US.json';
import jaJP from '../../../../messages/ja-JP.json';
import koKR from '../../../../messages/ko-KR.json';

/** catalog 按点路径取叶子值 */
function lookup(catalog: unknown, key: string): unknown {
  let node = catalog;
  for (const seg of key.split('.')) node = (node as Record<string, unknown>)[seg];
  return node;
}

/** ZOO-164：模板分组数据完整性（分组渲染的前提）；ZOO-176：id 与资源键对齐；
 *  ZOO-213：分组演进为学段·学科视图——「常用」交叉引用 + 学段组划分。 */
describe('模板分组（TEMPLATE_GROUPS / groupTemplates）', () => {
  it('面板模板每个恰属一个学段组（学段组两两不交、并集全覆盖）', () => {
    const stageIds = TEMPLATE_GROUPS.filter((g) => g.id !== COMMON_GROUP_ID)
      .flatMap((g) => g.templateIds);
    // 学段组内 / 组间无重复（每模板恰一个学段归属）
    expect(new Set(stageIds).size).toBe(stageIds.length);
    // 双向对齐：学段组收集到的 id 集合 === 平铺模板 id 集合（无遗漏）
    expect(new Set(stageIds)).toEqual(new Set(EQUATION_TEMPLATES.map((t) => t.id)));
  });

  it('「常用」置顶组交叉引用既有模板（引用有效、组内不重复）', () => {
    expect(TEMPLATE_GROUPS[0]).toMatchObject({ id: COMMON_GROUP_ID });
    const common = TEMPLATE_GROUPS[0];
    const ids = common.templateIds;
    expect(new Set(ids).size).toBe(ids.length);
    const allIds = new Set(EQUATION_TEMPLATES.map((t) => t.id));
    for (const id of ids) expect(allIds.has(id), id).toBe(true);
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

  it('首组为「常用」置顶组（默认展开组的确定性）', () => {
    expect(TEMPLATE_GROUPS[0]).toMatchObject({ id: COMMON_GROUP_ID });
  });
});

describe('i18n 资源键对齐（ZOO-176 / ZOO-213：四语言 catalog 逐键校验）', () => {
  it('每个模板 / 分组在四份 catalog 中都有非空显示名（缺键 = 不通过）', () => {
    const keys = [
      ...EQUATION_TEMPLATES.map((t) => templateNameKey(t.id)),
      ...TEMPLATE_GROUPS.map((g) => templateGroupNameKey(g.id)),
    ];
    for (const key of keys) {
      for (const catalog of [zhCN, enUS, jaJP, koKR]) {
        const value = lookup(catalog, key);
        expect(typeof value === 'string' && value.length > 0, `${key}`).toBe(true);
      }
    }
  });
});
