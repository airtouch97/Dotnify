import { useLang, type Lang } from "@/lib/i18n";
import { Segmented } from "./Segmented";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "zh-CN", label: "中文" },
];

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLang();
  return (
    <Segmented
      ariaLabel={t("language.label")}
      value={lang}
      onChange={setLang}
      className={className}
      options={OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.value === "en" ? "English" : "简体中文" }))}
    />
  );
}
