import { Button } from "./Button";
import { Icon } from "./Icon";

/** Inline error with an optional retry action. */
export function ErrorNote({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <Icon name="alert" size={14} />
        </span>
        <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <Icon name="refresh" size={14} />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
