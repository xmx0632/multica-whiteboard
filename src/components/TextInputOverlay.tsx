'use client';

import { useT } from '@/i18n/I18nProvider';

/**
 * 画布内联文本输入浮层（ZOO-159，替换 window.prompt）：
 *
 * - 卡片样式与既有浮层（属性面板 / 工具栏）同族：白底毛玻璃 + 圆角 + 阴影 + 灰边；
 * - 输入即预览：textarea 直接用目标字号（已乘视口 scale）与颜色渲染，
 *   确认落元素后视觉零跳变；宽高随内容实时度量自增长（measureTextElement）；
 * - 键序：Enter 确认 / Shift+Enter 换行（多行）/ Esc 取消；IME 组合态
 *   （isComposing）不拦截回车，中文输入法选词回车不误确认；
 * - 失焦（点画布 / 面板 / 切工具）提交；移动端软键盘经 scrollIntoView 避让。
 */
import { useLayoutEffect, useRef } from 'react';
import { measureTextElement } from '@/lib/textElement';

const CHROME = 7; // 卡片内边距 6px + 边框 1px：文本基线与落点对齐的偏移
const CARET_SLACK = 24; // 光标与待续输入余量
const MIN_WIDTH = 120;

interface TextInputOverlayProps {
  /** 文本首行左上角（画布 rect 相对屏幕 px，卡片 chrome 自偏移） */
  x: number;
  y: number;
  /** 屏幕 px 字号（世界字号 × 视口 scale，与画布渲染一致） */
  fontSizePx: number;
  color: string;
  value: string;
  /** 容器可用宽（右缘避让） */
  maxWidth: number;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function TextInputOverlay({
  x, y, fontSizePx, color, value, maxWidth, onChange, onConfirm, onCancel,
}: TextInputOverlayProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const t = useT();

  // 挂载即聚焦：光标置于末尾，并把输入卡滚入可视区（移动端软键盘避让）
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    ta.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const lines = value.split('\n');
  const measured = measureTextElement({ content: value, fontSize: fontSizePx, fontFamily: 'sans-serif' });
  const width = Math.max(MIN_WIDTH, measured.width + CARET_SLACK);

  return (
    <div
      className="absolute z-30 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-blue-200 p-1.5 flex flex-col gap-1"
      style={{ left: x - CHROME, top: y - CHROME, maxWidth: Math.max(MIN_WIDTH, maxWidth) }}
      data-text-input-overlay
    >
      <textarea
        ref={taRef}
        value={value}
        rows={Math.max(1, lines.length)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // IME 组合中的回车是选词确认，不是提交
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onConfirm();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onConfirm()}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        enterKeyHint="done"
        className="w-full bg-transparent outline-none resize-none overflow-hidden px-0 py-0 border-0 whitespace-pre"
        style={{
          fontSize: fontSizePx,
          lineHeight: 1.3,
          color,
          fontFamily: 'sans-serif',
          width,
          minHeight: fontSizePx * 1.3,
        }}
      />
      <div className="text-[10px] leading-none text-gray-400 select-none whitespace-nowrap">
        {t('textOverlay.hint')}
      </div>
    </div>
  );
}
