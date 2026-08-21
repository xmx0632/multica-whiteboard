'use client';

/**
 * 图层顺序操作组（ZOO-183）：选中元素后在属性面板出现，四个操作——
 * 置于最上层 / 置于最底层 / 上移一层 / 下移一层。
 *
 * 自取 store（elements / selectedId + 四 action），供两处面板复用：
 * 工具默认面板（PropertyPanel 态 3）与数学图形参数面板（MathPlotParams）。
 * 所有元素类型一视同仁；边界（已在顶 / 底层）按钮置灰，与 store 侧空转双保险。
 * 直接读 store 而非受控传参：z-order 只依赖选中态，无需面板转发。
 */
import { useStore } from '@/lib/store';
import { zOrderBounds } from '@/lib/zorder';
import { useT } from '@/i18n/I18nProvider';

export default function ArrangeGroup() {
  const t = useT();
  const { elements, selectedId, bringToFront, sendToBack, moveUp, moveDown } = useStore();
  const { atFront, atBack } = zOrderBounds(elements, selectedId);

  const btn =
    'touch-target h-7 rounded-md border text-xs flex items-center justify-center transition-colors ' +
    'border-gray-300 bg-white text-gray-600 hover:border-blue-500 hover:text-blue-500 active:bg-blue-50 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-600';

  return (
    <div>
      <label className="text-xs font-medium text-gray-500 mb-1 block">{t('panel.layer')}</label>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" onClick={bringToFront} disabled={atFront} title={t('panel.bringToFront')} aria-label={t('panel.bringToFront')} className={btn}>
          {t('panel.bringToFront')}
        </button>
        <button type="button" onClick={sendToBack} disabled={atBack} title={t('panel.sendToBack')} aria-label={t('panel.sendToBack')} className={btn}>
          {t('panel.sendToBack')}
        </button>
        <button type="button" onClick={moveUp} disabled={atFront} title={`${t('panel.bringForward')}（]）`} aria-label={t('panel.bringForward')} className={btn}>
          {t('panel.bringForward')}
        </button>
        <button type="button" onClick={moveDown} disabled={atBack} title={`${t('panel.sendBackward')}（[）`} aria-label={t('panel.sendBackward')} className={btn}>
          {t('panel.sendBackward')}
        </button>
      </div>
    </div>
  );
}
