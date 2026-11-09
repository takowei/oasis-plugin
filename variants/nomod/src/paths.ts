/** 展開開頭的 ~；其他路徑原樣回傳。 */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
  return path;
}

/** 新使用者的空城；plugin.json 的 userConfig.data_dir 預設必須和這個一致 */
export const DEFAULT_DATA_DIR = "~/workspace/oasis-city";
