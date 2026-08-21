import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * SITE_URL 解析链（ZOO-181）：显式环境变量 > Vercel 生产正式域名
 * > Vercel 预览专属地址 > 本地开发兜底。
 * SITE_URL 在模块加载时求值，用例间 resetModules + 动态导入重算。
 */

async function loadSiteUrl(): Promise<string> {
  const mod = await import('../site');
  return mod.SITE_URL;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('SITE_URL 解析', () => {
  it('NEXT_PUBLIC_SITE_URL 显式指定时优先级最高（尾斜杠剥除）', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://custom.example.com/');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(await loadSiteUrl()).toBe('https://custom.example.com');
  });

  it('Vercel 生产部署（未显式配置）回退正式域名', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_URL', 'whiteboard-xyz.vercel.app');
    expect(await loadSiteUrl()).toBe('https://board.readpodcast.top');
  });

  it('Vercel 预览部署使用部署专属地址', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'whiteboard-git-feat-seo.vercel.app');
    expect(await loadSiteUrl()).toBe(
      'https://whiteboard-git-feat-seo.vercel.app',
    );
  });

  it('本地开发（无 Vercel 环境）回退 localhost', async () => {
    expect(await loadSiteUrl()).toBe('http://localhost:3000');
  });
});
