/**
 * 移动端横屏全屏（ZOO-152 追加需求）。
 *
 * 按钮模式判定以纯函数沉淀（单测覆盖），DOM 侧（Fullscreen API +
 * 屏幕方向锁）为浏览器能力薄封装：
 * - 进入：requestFullscreen（需用户手势，浏览器安全约束）后尝试
 *   screen.orientation.lock('landscape')（Android Chrome 全屏态支持；
 *   iOS Safari 无元素全屏 API → 按钮自动隐藏，物理旋转即可）；
 * - 退出：document.exitFullscreen()（方向锁随全屏会话自动释放）。
 */

export interface FullscreenCapability {
  /** document.documentElement.requestFullscreen 可用 */
  requestFullscreen: boolean;
  /** document.exitFullscreen 可用 */
  exitFullscreen: boolean;
}

export function fullscreenSupported(cap: FullscreenCapability): boolean {
  return cap.requestFullscreen && cap.exitFullscreen;
}

/** 全屏按钮四态：隐藏 / 进入（竖屏，点击附带横屏锁定）/ 进入 / 退出 */
export type FullscreenButtonMode = 'hidden' | 'enter-landscape' | 'enter' | 'exit';

export interface FullscreenButtonInput {
  /** 粗指针（触摸设备）——桌面不显示（F11 由浏览器承担） */
  coarse: boolean;
  /** 浏览器支持元素全屏（iOS Safari 不支持） */
  supported: boolean;
  /** 当前处于全屏 */
  fullscreen: boolean;
  /** 当前横向视口 */
  landscape: boolean;
}

export function fullscreenButtonMode(input: FullscreenButtonInput): FullscreenButtonMode {
  if (!input.coarse || !input.supported) return 'hidden';
  if (input.fullscreen) return 'exit';
  return input.landscape ? 'enter' : 'enter-landscape';
}

/** screen.orientation.lock 的最小能力面（TS DOM lib 未收录该非标准 API） */
type OrientationLockable = { lock?: (orientation: string) => Promise<void> };

/** 进入全屏并锁定横屏（方向锁失败不阻塞：部分浏览器 / 已锁定态不支持）。 */
export async function enterFullscreenLandscape(): Promise<boolean> {
  const el = document.documentElement;
  if (!el.requestFullscreen || !document.exitFullscreen) return false;
  try {
    await el.requestFullscreen();
  } catch {
    return false; // 无用户手势 / 被策略拦截
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & OrientationLockable;
    await orientation.lock?.('landscape');
  } catch {
    /* iOS / 桌面 Safari / 不支持方向锁：全屏已达成，方向交由物理旋转 */
  }
  return true;
}

/** 退出全屏（方向锁随全屏会话自动释放）。 */
export async function exitFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    /* noop */
  }
}
