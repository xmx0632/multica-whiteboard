'use client';

import { useStore } from '@/lib/store';
import { COLORS } from '@/lib/types';

export default function PropertyPanel() {
  const { activeTool, strokeColor, setStrokeColor, strokeWidth, setStrokeWidth, fillColor, setFillColor, fontSize, setFontSize } = useStore();

  const showFill = ['rectangle', 'circle'].includes(activeTool);
  const showFont = activeTool === 'text';

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-48 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Stroke</label>
        <div className="flex flex-wrap gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setStrokeColor(c)}
              className={`w-5 h-5 rounded-full border-2 ${strokeColor === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => setStrokeColor(e.target.value)}
            className="w-5 h-5 rounded cursor-pointer border border-gray-300"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Width: {strokeWidth}px</label>
        <input
          type="range"
          min={1}
          max={50}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
      </div>

      {showFill && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
            <input
              type="checkbox"
              checked={fillColor !== null}
              onChange={(e) => setFillColor(e.target.checked ? '#3B82F6' : null)}
              className="accent-blue-500"
            />
            Fill
          </label>
          {fillColor !== null && (
            <div className="flex flex-wrap gap-1 mt-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setFillColor(c)}
                  className={`w-5 h-5 rounded-full border-2 ${fillColor === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={fillColor}
                onChange={(e) => setFillColor(e.target.value)}
                className="w-5 h-5 rounded cursor-pointer border border-gray-300"
              />
            </div>
          )}
        </div>
      )}

      {showFont && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Font Size: {fontSize}px</label>
          <input
            type="range"
            min={10}
            max={72}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
      )}
    </div>
  );
}
