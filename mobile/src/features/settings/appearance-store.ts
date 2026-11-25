import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    DEFAULT_APPEARANCE,
    legacyImageBackground,
    normalizeAppearance,
} from './appearance-types';
import type {
    AppearanceSettings,
    AppBackground,
    BubbleRadiusId,
    CustomAppBackground,
    ThemeMode,
} from './appearance-types';
import type { AccentId } from '../../shared/theme/colors';
import type { FontId } from '../../shared/theme/fonts';

/**
 * The single appearance store.
 *
 * - One zustand store (the project already uses zustand for auth, dialogs…).
 * - Persisted with AsyncStorage (the project's non-secret storage layer —
 *   SecureStore stays reserved for tokens).
 * - `hydrated` flips only after rehydration finishes (success OR failure), so
 *   the root layout can keep the splash up and never paint default appearance
 *   for a frame.
 *
 * Storage layout: one JSON record under `APPEARANCE_STORAGE_KEY`. The previous
 * release stored the global background as `chatBackground` inside that record;
 * `version: 2` migrates it to `appBackground` once, so existing users keep the
 * background they picked. The legacy field is dropped by `partialize` on the
 * next write.
 */

interface AppearanceState extends AppearanceSettings {
    hydrated: boolean;
    setThemeMode: (mode: ThemeMode) => void;
    setAccentColor: (accent: AccentId) => void;
    setAppBackground: (background: AppBackground) => void;
    /** Stores/clears the gallery image file reference (independent of selection). */
    setCustomBackground: (background: CustomAppBackground | null) => void;
    setBubbleOwnColor: (color: string | null) => void;
    setBubbleOtherColor: (color: string | null) => void;
    setBubbleRadius: (radius: BubbleRadiusId) => void;
    setTextScale: (scale: number) => void;
    setFontFamily: (font: FontId) => void;
    resetAppearance: () => void;
    setHydrated: (hydrated: boolean) => void;
}

export const APPEARANCE_STORAGE_KEY = 'niazchat.appearance.v1';
export const APPEARANCE_STORAGE_VERSION = 4;

type PersistedAppearance = Partial<AppearanceSettings> & {
    chatBackground?: unknown;
};

export const useAppearanceStore = create<AppearanceState>()(
    persist(
        (set) => ({
            ...DEFAULT_APPEARANCE,
            hydrated: false,
            setThemeMode: (themeMode): void => {
                set({ themeMode });
            },
            setAccentColor: (accentColor): void => {
                set({ accentColor });
            },
            setAppBackground: (appBackground): void => {
                set({ appBackground });
            },
            setCustomBackground: (customBackground): void => {
                set({ customBackground });
            },
            setBubbleOwnColor: (bubbleOwnColor): void => {
                set({ bubbleOwnColor });
            },
            setBubbleOtherColor: (bubbleOtherColor): void => {
                set({ bubbleOtherColor });
            },
            setBubbleRadius: (bubbleRadius): void => {
                set({ bubbleRadius });
            },
            setTextScale: (textScale): void => {
                set({
                    textScale: normalizeAppearance({ textScale }).textScale,
                });
            },
            setFontFamily: (fontFamily): void => {
                set({ fontFamily });
            },
            resetAppearance: (): void => {
                set({ ...DEFAULT_APPEARANCE });
            },
            setHydrated: (hydrated): void => {
                set({ hydrated });
            },
        }),
        {
            name: APPEARANCE_STORAGE_KEY,
            version: APPEARANCE_STORAGE_VERSION,
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state): AppearanceSettings => ({
                themeMode: state.themeMode,
                accentColor: state.accentColor,
                appBackground: state.appBackground,
                customBackground: state.customBackground,
                bubbleOwnColor: state.bubbleOwnColor,
                bubbleOtherColor: state.bubbleOtherColor,
                bubbleRadius: state.bubbleRadius,
                textScale: state.textScale,
                fontFamily: state.fontFamily,
            }),
            migrate: (persisted, version): AppearanceSettings => {
                const record =
                    typeof persisted === 'object' && persisted !== null
                        ? (persisted as PersistedAppearance)
                        : {};
                const source: PersistedAppearance =
                    record.appBackground === undefined &&
                    record.chatBackground !== undefined
                        ? {
                              ...record,
                              appBackground:
                                  record.chatBackground as AppBackground,
                          }
                        : record;
                // v4 split the stored gallery image out of the selection.
                const image = legacyImageBackground(source.appBackground);
                const migrated = normalizeAppearance(
                    image === null
                        ? source
                        : {
                              ...source,
                              customBackground: {
                                  id: 'bg-legacy',
                                  uri: image.uri,
                                  thumbnailUri: image.uri,
                              },
                              appBackground: {
                                  kind: 'image',
                                  id: 'bg-legacy',
                                  blur: image.blur,
                                  dim: image.dim,
                              },
                          },
                );
                // v3 made the two accent circles an explicit preset. Anyone
                // who never picked a background had the old `default` saved;
                // keep their look unchanged by mapping it to `circles` once.
                if (version < 3 && migrated.appBackground.kind === 'default') {
                    return { ...migrated, appBackground: { kind: 'circles' } };
                }
                return migrated;
            },
            merge: (persisted, current): AppearanceState => ({
                ...current,
                ...normalizeAppearance(
                    persisted as PersistedAppearance | undefined,
                ),
            }),
            onRehydrateStorage: () => (state): void => {
                // Runs after a successful restore AND after a read error.
                state?.setHydrated(true);
                if (state !== undefined) {
                    // Rewrite the record in the v2 shape once, which drops the
                    // legacy `chatBackground` field from storage.
                    useAppearanceStore.setState({
                        appBackground: state.appBackground,
                    });
                }
            },
        },
    ),
);

/** True once persisted appearance values (or defaults) are in place. */
export function useAppearanceHydrated(): boolean {
    return useAppearanceStore((state) => state.hydrated);
}

/**
 * Non-reactive snapshot for places that cannot use hooks (e.g. the splash
 * background color chosen before React mounts).
 */
export function currentAppearance(): AppearanceSettings {
    const state = useAppearanceStore.getState();
    return {
        themeMode: state.themeMode,
        accentColor: state.accentColor,
        appBackground: state.appBackground,
        customBackground: state.customBackground,
        bubbleOwnColor: state.bubbleOwnColor,
        bubbleOtherColor: state.bubbleOtherColor,
        bubbleRadius: state.bubbleRadius,
        textScale: state.textScale,
        fontFamily: state.fontFamily,
    };
}
