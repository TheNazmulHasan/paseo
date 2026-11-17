import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS, normalizeAppSettings } from "@/hooks/use-settings/storage";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import {
  hasLandedOnHome,
  markLandedOnHome,
  resetHomeLandingForTests,
  shouldOpenHomeOnLaunch,
} from "./launch";

const baseIndexInput = {
  route: { kind: "index" as const, pathname: "/" },
  startupBlocker: { kind: "none" as const },
  hostRegistryStatus: "ready" as const,
  hosts: [{ serverId: "server-1" }],
  anyOnlineHostServerId: "server-1",
  workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
  workspaceSelectionStatus: "exists" as const,
  isWorkspaceSelectionLoaded: true,
  hasGivenUpWaitingForHost: false,
  isWaitingForSetup: false,
};

describe("Open Home on launch: the setting", () => {
  it("is on by default", () => {
    expect(DEFAULT_CLIENT_SETTINGS.openHomeOnLaunch).toBe(true);
    expect(normalizeAppSettings({}).openHomeOnLaunch).toBe(true);
  });

  it("can be turned off and stays off; junk falls back to on", () => {
    expect(normalizeAppSettings({ openHomeOnLaunch: false }).openHomeOnLaunch).toBe(false);
    expect(normalizeAppSettings({ openHomeOnLaunch: true }).openHomeOnLaunch).toBe(true);
    expect(normalizeAppSettings({ openHomeOnLaunch: "no" }).openHomeOnLaunch).toBe(true);
  });
});

describe("shouldOpenHomeOnLaunch", () => {
  it("opens Home on a desktop cold start with the setting on", () => {
    expect(shouldOpenHomeOnLaunch({ enabled: true, isDesktop: true, landed: false })).toBe(true);
  });

  it("does nothing with the setting off, off the desktop app, or after Home was reached", () => {
    expect(shouldOpenHomeOnLaunch({ enabled: false, isDesktop: true, landed: false })).toBe(false);
    expect(shouldOpenHomeOnLaunch({ enabled: true, isDesktop: false, landed: false })).toBe(false);
    expect(shouldOpenHomeOnLaunch({ enabled: true, isDesktop: true, landed: true })).toBe(false);
  });
});

describe("landing on Home", () => {
  beforeEach(() => resetHomeLandingForTests());

  it("flips once Home has been on screen, so later index visits restore the workspace", () => {
    expect(hasLandedOnHome()).toBe(false);
    markLandedOnHome();
    expect(hasLandedOnHome()).toBe(true);
  });
});

describe("the startup route with Open Home on launch", () => {
  it("lands on Home instead of restoring the last workspace", () => {
    expect(resolveStartupRoute({ ...baseIndexInput, openHomeOnLaunch: true })).toEqual({
      kind: "redirect",
      href: "/home",
    });
  });

  it("still restores the last workspace when the setting is off or absent", () => {
    const restored = { kind: "redirect", href: "/h/server-1" };
    expect(resolveStartupRoute({ ...baseIndexInput, openHomeOnLaunch: false })).toEqual(restored);
    expect(resolveStartupRoute(baseIndexInput)).toEqual(restored);
  });

  it("keeps the splash while the workspace selection loads, and never skips the host check", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        openHomeOnLaunch: true,
        isWorkspaceSelectionLoaded: false,
      }),
    ).toEqual({ kind: "splash" });
    // No saved host yet (first run): the usual onboarding path, not Home.
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        openHomeOnLaunch: true,
        hosts: [],
        anyOnlineHostServerId: null,
        workspaceSelection: null,
        hasGivenUpWaitingForHost: true,
      }),
    ).toEqual({ kind: "redirect", href: "/welcome" });
  });

  it("waits for the managed daemon like any other start", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        openHomeOnLaunch: true,
        startupBlocker: { kind: "managed-daemon-starting" },
      }),
    ).toEqual({ kind: "splash" });
  });
});
