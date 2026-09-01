import { describe, it, expect } from 'vitest';
import { isValidDocId, docFilePath } from '../docFile';

/** ZOO-253 回归：服务端持久化文档 id 校验（CWE-22 路径穿越修复）。
 *  合法 id 口径 = uuid（[A-Za-z0-9_-]{1,64}）；任何路径分隔符 / 上引用 /
 *  非字符串一律拒绝，杜绝 DATA_DIR 外任意 .json 读 / 写 / 删。 */
describe('isValidDocId', () => {
  it('放行 uuid 形态 id', () => {
    expect(isValidDocId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidDocId('abc123')).toBe(true);
    expect(isValidDocId('A_b-9')).toBe(true);
  });

  it('拒绝路径穿越 id', () => {
    expect(isValidDocId('../package')).toBe(false);
    // 编码态：% 不在白名单字符集内——真被框架解码出分隔符同样被拒；未解码时落盘也只是字面文件名，无穿越
    expect(isValidDocId('..%2F..%2Fetc')).toBe(false);
    expect(isValidDocId('a/b')).toBe(false);
    expect(isValidDocId('..')).toBe(false);
    expect(isValidDocId('.')).toBe(false);
    expect(isValidDocId('foo/../../bar')).toBe(false);
    expect(isValidDocId('')).toBe(false);
  });

  it('拒绝非字符串与超长 id', () => {
    expect(isValidDocId(42)).toBe(false);
    expect(isValidDocId(null)).toBe(false);
    expect(isValidDocId(undefined)).toBe(false);
    expect(isValidDocId({ toString: () => 'x' })).toBe(false);
    expect(isValidDocId('a'.repeat(65))).toBe(false);
    expect(isValidDocId('a'.repeat(64))).toBe(true);
  });
});

describe('docFilePath', () => {
  const DIR = '/data/.whiteboard-data';

  it('合法 id 落在数据目录内', () => {
    expect(docFilePath(DIR, '550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/data/.whiteboard-data/550e8400-e29b-41d4-a716-446655440000.json'
    );
  });

  it('非法 id 返回 null，永不逃逸出数据目录', () => {
    for (const bad of ['../package', '..', '', 'a/b', null, undefined, 5]) {
      expect(docFilePath(DIR, bad as never)).toBeNull();
      // 关键断言：无论输入如何拼出的路径必不含 .. 段
      const p = docFilePath(DIR, bad as never);
      if (p) expect(p.includes('/../')).toBe(false);
    }
  });
});
