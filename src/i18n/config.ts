/**
 * i18n 语言解析（ZOO-176）—— 纯函数，无 React / Next 依赖，可单测。
 *
 * 优先级：cookie 用户偏好 > Accept-Language 协商 > 默认 zh-CN。
 * 语言匹配规则：精确（zh-CN / en-US）→ 语言主子串匹配（zh-TW → zh-CN、en-GB → en-US）
 * → 不支持的语言回退默认 zh-CN。GeoIP 不引入：语言 ≠ 地理，浏览器语言偏好
 * （Accept-Language 即 navigator.languages 的 HTTP 投影）已是更准的信号。
 */

export const LOCALES = ['zh-CN', 'en-US'] as const;

export type Locale = (typeof LOCALES)[number];

/** 默认语言：检测不到 / 不支持时回退（ZOO-176 需求 1）。 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** 记录用户手动切换偏好的 cookie（优先级高于自动检测）。 */
export const LOCALE_COOKIE = 'locale';

/** cookie 有效期：1 年（手动切换视为持久偏好）。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * 单个语言标签 → 支持语言匹配：
 * 'zh-CN' → 'zh-CN'；'zh-TW' / 'zh' → 'zh-CN'；'en-GB' / 'en' → 'en-US'；其余 null。
 */
export function matchLocale(tag: string): Locale | null {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return null;
  for (const locale of LOCALES) {
    if (normalized === locale.toLowerCase()) return locale;
  }
  const language = normalized.split('-')[0];
  for (const locale of LOCALES) {
    if (language === locale.split('-')[0].toLowerCase()) return locale;
  }
  return null;
}

/**
 * Accept-Language 协商（RFC 9110 简化实现，免 negotiator 依赖）：
 * 按 q 值降序逐个尝试 matchLocale，全部不支持 → null（调用方回退默认语言）。
 */
export function resolveFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      let q = 1;
      for (const param of params) {
        const [k, v] = param.trim().split('=');
        if (k === 'q') {
          const parsed = Number.parseFloat(v);
          if (Number.isFinite(parsed)) q = parsed;
        }
      }
      return { tag: tag ?? '', q };
    })
    .filter((c) => c.tag !== '' && c.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of candidates) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return null;
}

/** 解析入口：cookie（有效值）> Accept-Language > 默认 zh-CN。 */
export function resolveLocale(cookieValue?: string | null, acceptLanguage?: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return resolveFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
