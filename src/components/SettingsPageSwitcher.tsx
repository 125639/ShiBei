"use client";

import { useUserPrefs, type UserPrefs } from "./useUserPrefs";
import { UserSettingsClient } from "./UserSettingsClient";
import { CyberSettingsClient } from "./CyberSettingsClient";
import { DynamicSettingsClient } from "./DynamicSettingsClient";

type SettingsDefaults = Pick<UserPrefs, "theme" | "font" | "density" | "language" | "ui" | "musicEnabled">;

export function SettingsPageSwitcher({
  siteDefaults,
}: {
  siteDefaults: SettingsDefaults;
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
