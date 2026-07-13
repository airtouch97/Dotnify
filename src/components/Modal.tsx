import { useEffect, type ReactNode } from "react";

interface ModalProps {
  /** When false, the modal renders nothing. Defaults to true. */
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class for the panel. Defaults to max-w-lg. */
  size?: string;
}

/**
 * Centered modal dialog rendered above a dimmed backdrop.
 *
 * - Appears at the center of the screen, above a semi-transparent overlay.
 * - Closes on Escape, backdrop click, or the header close button.
 * - Locks body scroll while open and restores it on close.
 * - Content area scrolls independently when it exceeds 90% of the viewport.
 */
export function Modal({ open = true, title, description, onClose, children, size = "max-w-lg" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative flex max-h-[90vh] w-full ${size} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800`}
      >
        {(title || description) && (
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>
        )}
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
