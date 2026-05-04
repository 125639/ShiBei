"use client";

import { useUserPrefs } from "./useUserPrefs";
import { UserSettingsClient } from "./UserSettingsClient";
import { CyberSettingsClient } from "./CyberSettingsClient";

export function SettingsPageSwitcher({
  siteDefaults,
}: {
  siteDefaults: {
    theme: string;
    font: string;
    density: string;
    language: string;
    ui: string;
    musicEnabled: boolean;
  };
}) {
  const { prefs, hydrated } = useUserPrefs();

  if (!hydrated) return null;

  const currentUI = prefs.ui === "system" ? siteDefaults.ui : prefs.ui;

  if (currentUI === "cyber") {
    return <CyberSettingsClient siteDefaults={siteDefaults} />;
  }

  return <UserSettingsClient siteDefaults={siteDefaults} />;
}
