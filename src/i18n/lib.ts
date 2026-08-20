/**
 * 非 React 侧翻译器（ZOO-176）—— parse / conic / templates / export 等 lib 模块
 * 产生用户可见文案时注入；默认 zhT 返回与历史行为逐字节一致的中文
 * （既有单测断言原始文案，零改动通过）。
 *
 * key 为点分路径（'mathErr.badChar'）；占位符 {name} 用 params 替换。
 * 缺 key 时回退 zh-CN，仍缺则返回 key 本身（开发期可见、不静默）。
 */
import zhCN from '../../messages/zh-CN.json';
import enUS from '../../messages/en-US.json';
import jaJP from '../../messages/ja-JP.json';
import koKR from '../../messages/ko-KR.json';
import { DEFAULT_LOCALE, isLocale, type Locale } from './config';

type Messages = Record<string, unknown>;

const CATALOGS: Record<Locale, Messages> = {
  'zh-CN': zhCN as Messages,
  'en-US': enUS as Messages,
  'ja-JP': jaJP as Messages,
  'ko-KR': koKR as Messages,
};

export type LibT = (key: string, params?: Record<string, string | number>) => string;

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const seg of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** 指定语言的翻译函数：en-US 缺 key 回退 zh-CN（界面无缺文案）。 */
export function getLibT(locale: string): LibT {
  const catalog = isLocale(locale) ? CATALOGS[locale] : CATALOGS[DEFAULT_LOCALE];
  return (key, params) => {
    const template = lookup(catalog, key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key;
    return interpolate(template, params);
  };
}

/** lib 默认翻译器（中文）：不传 t 的调用方（既有单测 / 服务端兜底）行为不变。 */
export const zhT: LibT = getLibT(DEFAULT_LOCALE);
