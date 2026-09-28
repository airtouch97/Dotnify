import { useTheme, type Theme } from "@/lib/theme";
import { useLang } from "@/lib/i18n";
import { Icon } from "./Icon";
import { Segmented } from "./Segmented";

/** Light / Dark / Auto appearance picker. `compact` shows icons only. */
export function AppearanceSwitch({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useLang();
  const opts: { value: Theme; icon: "sun" | "moon" | "refresh"; label: string }[] = [
    { value: "light", icon: "sun", label: t("appearance.light") },
    { value: "dark", icon: "moon", label: t("appearance.dark") },
    { value: "system", icon: "refresh", label: t("appearance.system") },
  ];
  return (
    <Segmented
      ariaLabel={t("appearance.label")}
      value={theme}
      onChange={setTheme}
      className={className}
      options={opts.map((o) => ({
        value: o.value,
        title: o.label,
        label: compact ? (
          o.value === "system" ? <span className="text-[11px] font-semibold">A</span> : <Icon name={o.icon} size={15} />
        ) : (
          <>
            {o.value !== "system" && <Icon name={o.icon} size={14} />}
            <span>{o.label}</span>
          </>
        ),
      }))}
    />
  );
}
