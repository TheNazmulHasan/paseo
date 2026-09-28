import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { Eye } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  useAttentionBannerStore,
  type AttentionBannerPayload,
} from "@/stores/attention-banner-store";
import { buildNotificationRoute } from "@/utils/notification-routing";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import type { Theme } from "@/styles/theme";

const AUTO_DISMISS_MS = 5000;
const ThemedEye = withUnistyles(Eye);
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Attention banner for when the user is in Paseo but on the wrong agent/terminal.
 * Desktop: a quiet card at the bottom of the left sidebar, just above the footer
 * (rendered by `SidebarAttentionBanner`), so it never covers the tab bar. Compact:
 * the original center-top overlay, since the sidebar is hidden there.
 * This host owns auto-dismiss and the peek sheet for both placements. Peek shows the
 * notification body in a read-only modal without navigating away or marking the
 * underlying agent attention as seen.
 */
export function AttentionBannerHost() {
  const banner = useAttentionBannerStore((state) => state.banner);
  const dismiss = useAttentionBannerStore((state) => state.dismiss);
  const peeked = useAttentionBannerStore((state) => state.peeked);
  const closePeek = useAttentionBannerStore((state) => state.closePeek);
  const isCompact = useIsCompactFormFactor();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!banner || peeked) {
      // Keep the banner stable while the user is peeking details.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [banner, dismiss, peeked]);

  const peekHeader = useMemo<SheetHeader>(
    () => ({
      title: peeked?.title ?? "Notification",
      onClose: closePeek,
    }),
    [closePeek, peeked?.title],
  );

  const bannerContent =
    banner && isCompact ? (
      <View pointerEvents="box-none" style={styles.host} testID="attention-banner-host">
        <AttentionBannerCard style={styles.containerCompact} />
      </View>
    ) : null;

  const portalBanner =
    bannerContent && isWeb && typeof document !== "undefined"
      ? createPortal(bannerContent, getOverlayRoot())
      : bannerContent;

  return (
    <>
      {portalBanner}
      <AdaptiveModalSheet
        visible={peeked !== null}
        onClose={closePeek}
        header={peekHeader}
        testID="attention-notification-peek"
      >
        <View style={styles.peekBody}>
          {peeked?.body ? (
            <Text style={styles.peekBodyText} selectable>
              {peeked.body}
            </Text>
          ) : (
            <Text style={styles.peekEmptyText}>No additional details.</Text>
          )}
          <Button variant="outline" onPress={closePeek} testID="attention-notification-peek-close">
            Close
          </Button>
        </View>
      </AdaptiveModalSheet>
    </>
  );
}

/** Desktop placement: sits in the left sidebar directly above the Add project footer. */
export function SidebarAttentionBanner() {
  const hasBanner = useAttentionBannerStore((state) => state.banner !== null);
  const isCompact = useIsCompactFormFactor();
  if (!hasBanner || isCompact) {
    return null;
  }
  return (
    <View style={styles.sidebarSlot} testID="attention-banner-sidebar">
      <AttentionBannerCard style={styles.containerSidebar} />
    </View>
  );
}

function AttentionBannerCard({ style }: { style: object }) {
  const banner = useAttentionBannerStore((state) => state.banner);
  const dismiss = useAttentionBannerStore((state) => state.dismiss);
  const peek = useAttentionBannerStore((state) => state.peek);
  const router = useRouter();

  const handleOpen = useCallback(
    (payload: AttentionBannerPayload) => {
      const route = buildNotificationRoute(payload.data);
      dismiss();
      router.navigate(route);
    },
    [dismiss, router],
  );

  const handlePress = useCallback(() => {
    if (!banner) {
      return;
    }
    handleOpen(banner);
  }, [banner, handleOpen]);

  const containerStyle = useMemo(() => [styles.container, style], [style]);

  if (!banner) {
    return null;
  }
  return (
    <View style={containerStyle} testID="attention-banner">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${banner.title}${banner.extraCount > 0 ? ` +${banner.extraCount}` : ""}`}
        onPress={handlePress}
        style={styles.mainPressable}
        testID="attention-banner-open"
      >
        <Text style={styles.title} numberOfLines={1}>
          {banner.title}
          {banner.extraCount > 0 ? ` +${banner.extraCount}` : ""}
        </Text>
        {banner.body ? (
          <Text style={styles.body} numberOfLines={2}>
            {banner.body}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Peek notification"
        onPress={peek}
        style={styles.peekButton}
        hitSlop={8}
        testID="attention-banner-peek"
      >
        <ThemedEye size={16} uniProps={mutedIconColor} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  host: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    zIndex: OVERLAY_Z.toast + 1,
    alignItems: "center",
    pointerEvents: "box-none",
  },
  container: {
    maxWidth: 440,
    width: "90%",
    backgroundColor: theme.colors.popover,
    borderRadius: theme.borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  containerCompact: {
    maxWidth: 360,
  },
  sidebarSlot: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  containerSidebar: {
    width: "100%",
    maxWidth: undefined,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    shadowOpacity: 0,
    elevation: 0,
  },
  mainPressable: {
    flex: 1,
    minWidth: 0,
  },
  peekButton: {
    minWidth: 28,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  body: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  peekBody: {
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[4],
  },
  peekBodyText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  peekEmptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
