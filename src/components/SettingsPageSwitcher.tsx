"use client";

import { useUserPrefs } from "./useUserPrefs";
import { UserSettingsClient } from "./UserSettingsClient";
import { CyberSettingsClient } from "./CyberSettingsClient";
import { DynamicSettingsClient } from "./DynamicSettingsClient";

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
  const { prefs } = useUserPrefs(siteDefaults);

  const currentUI = prefs.ui === "system" ? siteDefaults.ui : prefs.ui;

  if (currentUI === "cyber") {
    return <CyberSettingsClient siteDefaults={siteDefaults} />;
  }

  if (currentUI === "dynamic") {
    return <DynamicSettingsClient siteDefaults={siteDefaults} />;
  }

  return <UserSettingsClient siteDefaults={siteDefaults} />;
}
