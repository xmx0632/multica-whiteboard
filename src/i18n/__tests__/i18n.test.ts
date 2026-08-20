/**
 * i18n 基础设施单测（ZOO-176）：
 * - 全部语言 catalog 的 key 集合完全一致（新增语言不改组件代码的前提）；
 * - Accept-Language 协商与回退规则（含 ja-JP / ko-KR）；
 * - 翻译器占位符插值与缺 key 回退（无 key 泄漏到界面）。
 */
import { describe, expect, it } from 'vitest';
import zhCN from '../../../messages/zh-CN.json';
import enUS from '../../../messages/en-US.json';
import jaJP from '../../../messages/ja-JP.json';
import koKR from '../../../messages/ko-KR.json';
import {
  DEFAULT_LOCALE,
  LOCALES,
  matchLocale,
  resolveFromAcceptLanguage,
  resolveLocale,
} from '../config';
import { getLibT } from '../lib';

/** 全部 catalog（语言集新增语言时在此补一行，其余断言自动覆盖） */
const CATALOGS = { 'zh-CN': zhCN, 'en-US': enUS, 'ja-JP': jaJP, 'ko-KR': koKR } as const;

function flattenKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe('语言 catalog 完整性', () => {
  it('所有语言的 key 集合与 zh-CN（形状基准）完全一致', () => {
    const zhKeys = new Set(flattenKeys(zhCN));
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const keys = new Set(flattenKeys(catalog));
      expect([...keys].filter((k) => !zhKeys.has(k)), locale).toEqual([]);
      expect([...zhKeys].filter((k) => !keys.has(k)), locale).toEqual([]);
    }
  });

  it('所有叶子值为非空字符串，占位符集合与 zh-CN 逐 key 一致', () => {
    const tokens = (s: string) => new Set(s.match(/\{(\w+)\}/g) ?? []);
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const key of flattenKeys(catalog)) {
        const parts = key.split('.');
        let node: unknown = catalog;
        for (const seg of parts) node = (node as Record<string, unknown>)[seg];
        expect(typeof node === 'string' && node.length > 0, `${locale}:${key}`).toBe(true);
        if (locale !== 'zh-CN') {
          let zhNode: unknown = zhCN;
          for (const seg of key.split('.')) zhNode = (zhNode as Record<string, unknown>)[seg];
          expect(tokens(node as string), `${locale}:${key}`).toEqual(tokens(zhNode as string));
        }
      }
    }
  });

  it('LOCALES 注册项与 catalog 文件一一对应', () => {
    expect(Object.keys(CATALOGS)).toEqual([...LOCALES]);
  });
});

describe('语言标签匹配', () => {
  it('精确命中', () => {
    expect(matchLocale('zh-CN')).toBe('zh-CN');
    expect(matchLocale('en-US')).toBe('en-US');
    expect(matchLocale('ja-JP')).toBe('ja-JP');
    expect(matchLocale('ko-KR')).toBe('ko-KR');
    expect(matchLocale('EN-us')).toBe('en-US');
    expect(matchLocale('JA-jp')).toBe('ja-JP');
  });

  it('语言主子串匹配（地区变体归并）', () => {
    expect(matchLocale('zh')).toBe('zh-CN');
    expect(matchLocale('zh-TW')).toBe('zh-CN');
    expect(matchLocale('en')).toBe('en-US');
    expect(matchLocale('en-GB')).toBe('en-US');
    expect(matchLocale('ja')).toBe('ja-JP');
    expect(matchLocale('ko')).toBe('ko-KR');
  });

  it('不支持的语言返回 null（由调用方回退默认）', () => {
    expect(matchLocale('fr-FR')).toBeNull();
    expect(matchLocale('th')).toBeNull();
    expect(matchLocale('')).toBeNull();
  });
});

describe('Accept-Language 协商', () => {
  it('按 q 值择优', () => {
    expect(resolveFromAcceptLanguage('fr-FR,fr;q=0.9,en-US;q=0.8')).toBe('en-US');
    expect(resolveFromAcceptLanguage('en-US,en;q=0.5')).toBe('en-US');
    expect(resolveFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN');
    expect(resolveFromAcceptLanguage('ja-JP,ja;q=0.9,en;q=0.8')).toBe('ja-JP');
    expect(resolveFromAcceptLanguage('ko-KR,ko;q=0.9,en-US;q=0.8')).toBe('ko-KR');
  });

  it('语言主子串兜底', () => {
    expect(resolveFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en-US');
    expect(resolveFromAcceptLanguage('zh')).toBe('zh-CN');
  });

  it('全部不支持 / 空头返回 null', () => {
    expect(resolveFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull();
    expect(resolveFromAcceptLanguage('')).toBeNull();
    expect(resolveFromAcceptLanguage(null)).toBeNull();
  });
});

describe('resolveLocale 优先级', () => {
  it('cookie 有效值优先于 Accept-Language', () => {
    expect(resolveLocale('en-US', 'zh-CN,zh;q=0.9')).toBe('en-US');
  });

  it('cookie 无效值回退 Accept-Language', () => {
    expect(resolveLocale('fr-FR', 'en-US,en;q=0.5')).toBe('en-US');
    expect(resolveLocale('', 'zh')).toBe('zh-CN');
  });

  it('两者皆无 → 默认 zh-CN', () => {
    expect(resolveLocale(null, null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, 'fr-FR')).toBe('zh-CN');
  });
});

describe('翻译器', () => {
  it('占位符插值（四语言）', () => {
    expect(getLibT('zh-CN')('menu.autosaved', { time: '12:30' })).toBe('✓ 已自动保存 12:30');
    expect(getLibT('en-US')('menu.autosaved', { time: '12:30' })).toBe('✓ Auto-saved 12:30');
    expect(getLibT('ja-JP')('menu.autosaved', { time: '12:30' })).toBe('✓ 自動保存 12:30');
    expect(getLibT('ko-KR')('menu.autosaved', { time: '12:30' })).toBe('✓ 자동 저장됨 12:30');
  });

  it('语言菜单自称恒为该语言自己的文案（不随界面语言变化）', () => {
    expect(getLibT('zh-CN')('lang.nativeName')).toBe('中文');
    expect(getLibT('en-US')('lang.nativeName')).toBe('English');
    expect(getLibT('ja-JP')('lang.nativeName')).toBe('日本語');
    expect(getLibT('ko-KR')('lang.nativeName')).toBe('한국어');
  });

  it('非法 locale 回退 zh-CN，两边都缺的 key 返回 key 本身', () => {
    expect(getLibT('fr-FR')('math.unrecognized')).toBe('无法识别的方程');
    expect(getLibT('en-US')('no.such.key')).toBe('no.such.key');
  });

  it('列表分隔符随语言（parse 错误列表拼接用）', () => {
    expect(getLibT('zh-CN')('common.listSep')).toBe('、');
    expect(getLibT('en-US')('common.listSep')).toBe(', ');
    expect(getLibT('ja-JP')('common.listSep')).toBe('、');
    expect(getLibT('ko-KR')('common.listSep')).toBe(', ');
  });
});
