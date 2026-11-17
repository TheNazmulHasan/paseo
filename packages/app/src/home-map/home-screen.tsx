import { useEffect, type ReactElement } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollView } from "@/components/ui/scroll-view";
import { ChiefBox } from "./chief-box";
import { HomeBand } from "./home-bands";
import { HomeMapSection } from "./home-map-tree";
import { markLandedOnHome } from "./launch";
import { useHomeData } from "./use-home-data";

/**
 * Home (fork mod, home-map): what needs me, and where is everything. Top to bottom: Needs you,
 * Your move, Working, then the map (Folder -> workspace -> session), with the Chief box docked at
 * the bottom. Everything is drawn from the app's live stores, so it updates with no polling.
 * Bands wrap: side by side when there is room, stacked when the window is narrow.
 */
export function HomeScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <HomeScreenContent />;
}

function HomeScreenContent(): ReactElement {
  const { t } = useTranslation();
  const { bands, tree, chief, loading } = useHomeData();

  // The cold-start redirect has done its job once Home is on screen; later visits to the index
  // route restore the last workspace as upstream does (see `launch.ts`).
  useEffect(() => {
    markLandedOnHome();
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      testID="home-screen"
    >
      <MenuHeader title={t("homeMap.title")} />
      {loading ? (
        <View style={styles.loading} testID="home-loading">
          <ThemedSpinner size="large" />
          <Text style={styles.loadingText}>{t("homeMap.map.loading")}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          testID="home-scroll"
        >
          <View style={styles.column}>
            <View style={styles.bands}>
              <HomeBand
                testID="home-band-needs-you"
                title={t("homeMap.bands.needsYou")}
                emptyText={t("homeMap.bands.needsYouEmpty")}
                sessions={bands.needsYou}
                showYourMove
                inRow
              />
              <HomeBand
                testID="home-band-your-move"
                title={t("homeMap.bands.yourMove")}
                emptyText={t("homeMap.bands.yourMoveEmpty")}
                sessions={bands.yourMove}
                showYourMove
                inRow
              />
            </View>
            <HomeBand
              testID="home-band-working"
              title={t("homeMap.bands.working")}
              emptyText=""
              sessions={bands.working}
              compact
              hideWhenEmpty
            />
            <HomeMapSection tree={tree} />
          </View>
        </ScrollView>
      )}
      <ChiefBox chief={chief} />
    </KeyboardAvoidingView>
  );
}

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const CONTENT_MAX_WIDTH = 960;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
  },
  column: {
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    gap: theme.spacing[4],
    minWidth: 0,
  },
  bands: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[4],
    minWidth: 0,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
