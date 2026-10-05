/**
 * Installed application version. Native builds ask Tauri so the value
 * describes the bundle the user is actually running. Browser mocks use
 * the package version injected by Vite.
 */
export const bundledAppVersion = __APP_VERSION__;

let installedVersion: Promise<string> | null = null;

export function getInstalledVersion(): Promise<string> {
  if (installedVersion) return installedVersion;
  installedVersion = (async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return bundledAppVersion;
    }
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      return bundledAppVersion;
    }
  })();
  return installedVersion;
}
