import path from 'path';

/**
 * 服务端持久化文档 id 校验（ZOO-253 回归）：
 * 文档 id 口径 = uuid v4（客户端 uuidv4 生成、localStorage 同源），
 * 白名单 [A-Za-z0-9_-]{1,64} 恒覆盖合法形态。凡路径分隔符 / 上引用 /
 * 百分号编码残留 / 非字符串一律拒绝——DATA_DIR 外任意 .json 的读
 * （GET）、改写（PATCH）、删除（DELETE / POST 覆盖写）在入口处即被拦截。
 */

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDocId(id: unknown): boolean {
  return typeof id === 'string' && DOC_ID_PATTERN.test(id);
}

/** 合法 id → 数据目录内文档文件路径；非法 id 返回 null，由调用方回 400/404。 */
export function docFilePath(dataDir: string, id: unknown): string | null {
  if (!isValidDocId(id)) return null;
  return path.join(dataDir, `${id}.json`);
}
