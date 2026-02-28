"use client";

interface ShortcutsHelpProps {
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["?"], label: "Toggle this help" },
    ],
  },
  {
    title: "Gallery",
    shortcuts: [
      { keys: ["A"], label: "Select all images" },
      { keys: ["D"], label: "Deselect all" },
      { keys: ["F"], label: "Favorite selected" },
      { keys: ["⌫"], label: "Delete selected" },
      { keys: ["U"], label: "Toggle upload" },
      { keys: ["S"], label: "Share gallery" },
    ],
  },
  {
    title: "Lightbox",
    shortcuts: [
      { keys: ["←", "→"], label: "Navigate images" },
      { keys: ["I"], label: "Toggle image info" },
      { keys: ["+", "−"], label: "Zoom in / out" },
      { keys: ["0"], label: "Reset zoom" },
      { keys: ["D"], label: "Download image" },
      { keys: ["Esc"], label: "Close lightbox" },
    ],
  },
];

/**
 * ShortcutsHelp — Floating panel showing all available keyboard shortcuts.
 * Toggled via "?" key.
 */
export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed bottom-6 right-6 z-[91] w-[280px] bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden fade-in">
        <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-stone-900">
            Keyboard Shortcuts
          </h3>
          <button
            onClick={onClose}
            className="text-[11px] text-stone-300 hover:text-stone-500 transition-colors"
          >
            esc
          </button>
        </div>

        <div className="px-4 py-3 space-y-4 max-h-[60vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-[10px] font-medium tracking-wider uppercase text-stone-300 mb-2">
                {group.title}
              </p>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[12px] text-stone-500">
                      {s.label}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {s.keys.map((key, i) => (
                        <kbd
                          key={i}
                          className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1 text-[10px] font-medium text-stone-400 bg-stone-50 border border-stone-200 rounded"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
