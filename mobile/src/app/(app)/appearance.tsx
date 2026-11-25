import { useCallback, useEffect, useState } from 'react';
import {
    Linking,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
    Check,
    ChevronLeft,
    Droplets,
    ImagePlus,
    Info,
    Moon,
    RotateCcw,
    Trash2,
} from 'lucide-react-native';
import {
    AppText,
    GlassHeader,
    Screen,
    SafeText,
    radii,
    spacing,
} from '../../shared/components';
import {
    useTheme,
    useThemedStyles,
} from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
import {
    ACCENT_PRESETS,
    BUBBLE_COLOR_PRESETS,
    GRADIENT_PRESETS,
    SOLID_BACKGROUND_PRESETS,
    readableTextColor,
} from '../../shared/theme/colors';
import {
    fontFamilyFor,
    fontOption,
    FONT_OPTIONS,
} from '../../shared/theme/fonts';
import { dialog, toast } from '../../shared/dialog';
import {
    BUBBLE_RADIUS_OPTIONS,
    DEFAULT_APPEARANCE,
    DEFAULT_IMAGE_BLUR,
    DEFAULT_IMAGE_DIM,
    PATTERN_OPTIONS,
    TEXT_SCALE_STEPS,
    THEME_MODE_OPTIONS,
    blurToPercent,
    dimToPercent,
    percentToBlur,
    percentToDim,
} from '../../features/settings/appearance-types';
import type {
    BubbleRadiusId,
    CustomAppBackground,
    ThemeMode,
} from '../../features/settings/appearance-types';
import { useAppearanceStore } from '../../features/settings/appearance-store';
import { AppBackgroundLayer } from '../../features/settings/app-background-layer';
import { FadingScrollEdges } from '../../shared/edge-fade';
import { AppValueSlider } from '../../features/settings/app-value-slider';
import {
    clearAppBackgroundPreview,
    setAppBackgroundPreview,
    useAppBackgroundPreview,
} from '../../features/settings/app-background-preview';
import {
    persistAppBackgroundImage,
    removeAllAppBackgroundImages,
    removeAppBackgroundImage,
} from '../../features/settings/app-background-storage';
import type { AppBackground } from '../../features/settings/appearance-types';
import type { FontId } from '../../shared/theme/fonts';

/**
 * Solid fill style for a color preset. Built by a helper instead of an inline
 * object literal so the Reanimated Babel plugin does not read the preset's
 * `.value` as a shared value inside an inline animated style (it is plain data).
 */
const colorFill = (color: string): { backgroundColor: string } => ({
    backgroundColor: color,
});

/**
 * Appearance settings.
 *
 * Every control writes straight to the persisted appearance store, so the
 * preview (and the whole app behind this screen) updates instantly. The sample
 * chat at the top is the single place to judge theme, accent, bubble colors,
 * radius, text size and font together.
 */

export default function AppearanceScreen(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    const settings = useAppearanceStore();
    const insets = useSafeAreaInsets();
    const [picking, setPicking] = useState(false);
    // Full-screen list geometry, exactly like the chats list: the header
    // floats over the scroll view, so its measured height is both the
    // content's top padding and the depth of the fade behind it.
    const [headerHeight, setHeaderHeight] = useState(0);
    const measureHeader = useCallback((event: LayoutChangeEvent): void => {
        const height = event.nativeEvent.layout.height;
        if (height <= 0) {
            return;
        }
        setHeaderHeight((previous): number =>
            Math.abs(previous - height) < 0.5 ? previous : height,
        );
    }, []);

    const confirmReset = (): void => {
        void dialog
            .confirm({
                title: 'Reset appearance?',
                message:
                    'Theme, accent, app background, bubbles, text size and font return to their defaults.',
                confirmText: 'Reset',
                destructive: true,
            })
            .then((confirmed): void => {
                if (confirmed) {
                    settings.resetAppearance();
                    void removeAllAppBackgroundImages();
                    toast.show('Appearance reset', { tone: 'success' });
                }
            });
    };

    const pickImage = async (): Promise<void> => {
        if (picking) {
            return;
        }
        if (Platform.OS !== 'web') {
            const permission =
                await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                dialog.show({
                    title: 'Photo access needed',
                    message:
                        'Allow photo access to choose an app background. You can change this later in Settings.',
                    tone: 'warning',
                    buttons: [
                        { text: 'Not now', style: 'cancel' },
                        {
                            text: 'Open settings',
                            onPress: (): void => {
                                void Linking.openSettings();
                            },
                        },
                    ],
                });
                return;
            }
        }
        setPicking(true);
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                // Re-encoded to JPEG 0.8 + max 1600 px by the storage layer.
                quality: 0.8,
            });
            if (result.canceled) {
                return;
            }
            const asset = result.assets[0];
            if (asset?.uri === undefined || asset.uri === '') {
                toast.show('Could not read that image', { tone: 'danger' });
                return;
            }
            // The previous file is only deleted once the new one is saved
            // AND selected, so a failed copy never loses the current photo.
            const previous = settings.customBackground;
            const image = await persistAppBackgroundImage(
                asset.uri,
                asset.width,
                asset.height,
            );
            settings.setCustomBackground(image);
            settings.setAppBackground({
                kind: 'image',
                id: image.id,
                blur: DEFAULT_IMAGE_BLUR,
                dim: DEFAULT_IMAGE_DIM,
            });
            if (previous !== null && previous.id !== image.id) {
                void removeAppBackgroundImage(previous);
            }
        } catch {
            toast.show('Could not save that image. Try another photo.', {
                tone: 'danger',
            });
        } finally {
            setPicking(false);
        }
    };

    /** Explicit removal: the only way the stored gallery image is deleted. */
    const removeCustomImage = (): void => {
        const current = settings.customBackground;
        if (current === null) {
            return;
        }
        void dialog
            .confirm({
                title: 'Remove background photo?',
                message:
                    'The photo is deleted from this device. You can pick another one at any time.',
                confirmText: 'Remove',
                destructive: true,
            })
            .then((confirmed): void => {
                if (!confirmed) {
                    return;
                }
                const wasSelected =
                    settings.appBackground.kind === 'image' &&
                    settings.appBackground.id === current.id;
                settings.setCustomBackground(null);
                if (wasSelected) {
                    settings.setAppBackground(DEFAULT_APPEARANCE.appBackground);
                }
                void removeAppBackgroundImage(current);
                toast.show('Background photo removed', { tone: 'success' });
            });
    };

    return (
        <Screen withTopInset={false} withBottomInset={false}>
            {/* Full-bleed, exactly like the chats list: the scroll view runs
                from the physical top edge to the physical bottom edge and the
                header floats over it. `topInset` / `bottomInset` become the
                content's padding (first item clears the header at rest, last
                item clears the home indicator) and the depth of the fade, so
                nothing is cut off with a hard line and no solid band appears
                over the app background. */}
            <FadingScrollEdges
                edges="both"
                fadeHeight={28}
                topInset={Math.round(headerHeight + spacing.xs)}
                bottomInset={Math.round(insets.bottom + spacing.md)}
            >
                <Animated.ScrollView
                    contentContainerStyle={styles.scroll}
                    showsVerticalScrollIndicator={false}
                >
                    <PreviewChat />

                    <Section
                        title="Theme"
                        subtitle="The whole app switches instantly."
                    >
                        <Segmented
                            options={THEME_MODE_OPTIONS}
                            value={settings.themeMode}
                            onChange={(value: ThemeMode): void => {
                                settings.setThemeMode(value);
                            }}
                        />
                        <Label
                            text="Accent color"
                            hint="Bubbles, buttons, links, tabs and badges"
                        />
                        <View style={styles.swatchRow}>
                            {ACCENT_PRESETS.map((preset) => {
                                const selected =
                                    settings.accentColor === preset.id;
                                return (
                                    <Pressable
                                        key={preset.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${preset.label} accent`}
                                        accessibilityState={{ selected }}
                                        onPress={(): void =>
                                            settings.setAccentColor(preset.id)
                                        }
                                        style={[
                                            styles.swatch,
                                            colorFill(preset.value),
                                            selected && styles.swatchSelected,
                                        ]}
                                    >
                                        {selected && (
                                            <Check
                                                size={16}
                                                color={readableTextColor(
                                                    preset.value,
                                                )}
                                                strokeWidth={3}
                                            />
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>
                    </Section>

                    <Section
                        title="App background"
                        subtitle="Shown behind every screen. Never inside a list."
                    >
                        <BackgroundPicker
                            value={settings.appBackground}
                            custom={settings.customBackground}
                            onChange={settings.setAppBackground}
                            onPickImage={(): void => {
                                void pickImage();
                            }}
                            onRemoveImage={removeCustomImage}
                            picking={picking}
                        />
                        <BackgroundEffects
                            background={settings.appBackground}
                            onChange={settings.setAppBackground}
                        />
                    </Section>

                    <Section
                        title="Message bubbles"
                        subtitle="Text color is chosen automatically for contrast."
                    >
                        <Label text="My bubbles" />
                        <BubbleColors
                            value={settings.bubbleOwnColor}
                            onChange={settings.setBubbleOwnColor}
                        />
                        <Label text="Their bubbles" />
                        <BubbleColors
                            value={settings.bubbleOtherColor}
                            onChange={settings.setBubbleOtherColor}
                        />
                        <Label text="Corner radius" />
                        <Segmented
                            options={BUBBLE_RADIUS_OPTIONS}
                            value={settings.bubbleRadius}
                            onChange={(value: BubbleRadiusId): void => {
                                settings.setBubbleRadius(value);
                            }}
                        />
                    </Section>

                    <Section
                        title="Text size"
                        subtitle="Scales message text and chat-list previews."
                    >
                        <View style={styles.scalePreview}>
                            <View
                                style={[
                                    styles.scaleBubble,
                                    {
                                        backgroundColor:
                                            theme.colors.bubbleOther,
                                        borderColor:
                                            theme.colors.bubbleBorder,
                                    },
                                ]}
                            >
                                <AppText
                                    style={[
                                        theme.type.message,
                                        {
                                            color: theme.colors.bubbleOtherText,
                                        },
                                    ]}
                                >
                                    Live preview · پیش‌نمایش زنده
                                </AppText>
                            </View>
                        </View>
                        <Segmented
                            options={TEXT_SCALE_STEPS.map((step) => ({
                                id: String(step),
                                label: `${Math.round(step * 100)}%`,
                            }))}
                            value={String(settings.textScale)}
                            onChange={(value: string): void => {
                                settings.setTextScale(Number(value));
                            }}
                        />
                    </Section>

                    <Section
                        title="Font"
                        subtitle="Persian-friendly, licensed for app bundling."
                    >
                        {FONT_OPTIONS.map((option) => {
                            const selected =
                                settings.fontFamily === option.id;
                            return (
                                <Pressable
                                    key={option.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${option.label} font`}
                                    accessibilityState={{ selected }}
                                    onPress={(): void =>
                                        settings.setFontFamily(option.id)
                                    }
                                    style={[
                                        styles.fontRow,
                                        selected && styles.fontRowSelected,
                                    ]}
                                >
                                    <View style={styles.fontBody}>
                                        <AppText
                                            style={[
                                                styles.fontName,
                                                {
                                                    color: theme.colors.text,
                                                    fontFamily:
                                                        fontFamilyFor(
                                                            option.id,
                                                            'bold',
                                                        ),
                                                },
                                            ]}
                                        >
                                            {option.label}
                                        </AppText>
                                        <AppText
                                            style={[
                                                styles.fontPreview,
                                                {
                                                    color:
                                                        theme.colors
                                                            .textSecondary,
                                                    fontFamily:
                                                        fontFamilyFor(
                                                            option.id,
                                                            'regular',
                                                        ),
                                                },
                                            ]}
                                        >
                                            سلام Amir · ۱۲۳ 456
                                        </AppText>
                                        <AppText
                                            style={[
                                                styles.fontMeta,
                                                {
                                                    color:
                                                        theme.colors
                                                            .textMuted,
                                                },
                                            ]}
                                        >
                                            {option.description} ·{' '}
                                            {option.license}
                                        </AppText>
                                    </View>
                                    <View
                                        style={[
                                            styles.radio,
                                            {
                                                borderColor: selected
                                                    ? theme.accent
                                                    : theme.colors
                                                          .borderStrong,
                                            },
                                        ]}
                                    >
                                        {selected && (
                                            <View
                                                style={[
                                                    styles.radioDot,
                                                    {
                                                        backgroundColor:
                                                            theme.accent,
                                                    },
                                                ]}
                                            />
                                        )}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </Section>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reset appearance to default"
                        onPress={confirmReset}
                        style={({ pressed }) => [
                            styles.resetButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <RotateCcw
                            size={16}
                            color={theme.colors.danger}
                            strokeWidth={2}
                        />
                        <AppText
                            style={[
                                styles.resetLabel,
                                { color: theme.colors.danger },
                            ]}
                        >
                            Reset to default
                        </AppText>
                    </Pressable>

                    <AppText
                        style={[
                            styles.persianHint,
                            { color: theme.colors.textMuted },
                        ]}
                    >
                        گزینه‌ها روی همین دستگاه ذخیره می‌شوند.
                    </AppText>
                </Animated.ScrollView>
            </FadingScrollEdges>

            {/* Transparent chrome over the faded content: the header keeps its
                own (unmasked) surface and stays fully tappable, while the
                scroll view dissolves underneath it. */}
            <View
                pointerEvents="box-none"
                style={[
                    styles.headerLayer,
                    {
                        paddingTop: insets.top + spacing.md,
                        paddingHorizontal: spacing.md,
                    },
                ]}
                onLayout={measureHeader}
            >
                <GlassHeader
                    layout="row"
                    leading={
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Back"
                            hitSlop={8}
                            onPress={(): void => router.back()}
                            style={styles.backButton}
                        >
                            <ChevronLeft
                                size={22}
                                color={theme.colors.text}
                                strokeWidth={2}
                            />
                        </Pressable>
                    }
                >
                    <AppText variant="heading">Appearance</AppText>
                    <AppText variant="caption">
                        Make NiazChat look the way you like
                    </AppText>
                </GlassHeader>
            </View>
        </Screen>
    );
}

/* ── Live chat preview ───────────────────────────────────────────────────── */

function PreviewChat(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    const radius = theme.radius.bubble;

    return (
        <View style={styles.previewCard}>
            <PreviewBackground />
            <View style={styles.previewInner}>
                    <View style={styles.previewAppBar}>
                        <AppText
                            style={[
                                styles.previewAppTitle,
                                { color: theme.colors.text },
                            ]}
                        >
                            Chats
                        </AppText>
                    </View>
                    <View
                        style={[
                            styles.previewListRow,
                            {
                                backgroundColor: theme.colors.glassSurface,
                                borderColor: theme.colors.border,
                            },
                        ]}
                    >
                        <View
                            style={[
                                styles.previewAvatar,
                                { backgroundColor: theme.colors.accentSoft },
                            ]}
                        />
                        <View style={styles.previewListBody}>
                            <AppText
                                style={[
                                    styles.previewListName,
                                    { color: theme.colors.text },
                                ]}
                                numberOfLines={1}
                            >
                                Ava
                            </AppText>
                            <AppText
                                style={[
                                    styles.previewListPreview,
                                    { color: theme.colors.textSecondary },
                                ]}
                                numberOfLines={1}
                            >
                                See you tomorrow
                            </AppText>
                        </View>
                    </View>
                    <View style={styles.previewSpacer} />
                    <View
                        style={[
                            styles.previewPill,
                        {
                            backgroundColor:
                                theme.colors.separatorPill,
                            borderColor:
                                theme.colors.separatorPillBorder,
                        },
                    ]}
                >
                    <AppText
                        style={[
                            styles.previewPillText,
                            { color: theme.colors.separatorPillText },
                        ]}
                    >
                        Today
                    </AppText>
                </View>
                <View
                    style={[
                        styles.previewBubble,
                        styles.previewTheirs,
                        {
                            backgroundColor: theme.colors.bubbleOther,
                            borderColor: theme.colors.bubbleBorder,
                            borderRadius: radius,
                            borderBottomLeftRadius: 4,
                        },
                    ]}
                >
                    <AppText
                        style={[
                            theme.type.message,
                            { color: theme.colors.bubbleOtherText },
                        ]}
                    >
                        Hi! Did you see the new theme?{' '}
                        <AppText
                            style={{
                                color: theme.colors.link,
                                textDecorationLine: 'underline',
                            }}
                        >
                            niaz.chat
                        </AppText>
                    </AppText>
                    <AppText
                        style={[
                            styles.previewMeta,
                            { color: theme.colors.bubbleOtherMuted },
                        ]}
                    >
                        09:41
                    </AppText>
                </View>
                <View
                    style={[
                        styles.previewBubble,
                        styles.previewMine,
                        {
                            backgroundColor: theme.colors.bubbleOwn,
                            borderColor: theme.colors.bubbleBorder,
                            borderRadius: radius,
                            borderBottomRightRadius: 4,
                        },
                    ]}
                >
                    <AppText
                        style={[
                            theme.type.message,
                            { color: theme.colors.bubbleOwnText },
                        ]}
                    >
                        Yes, it looks great — ممنون{' '}
                        <AppText
                            style={{
                                color: theme.colors.mentionOnOwn,
                                fontWeight: '600',
                                textDecorationLine: 'underline',
                            }}
                        >
                            @amir
                        </AppText>
                    </AppText>
                    <AppText
                        style={[
                            styles.previewMeta,
                            styles.previewMetaMine,
                            { color: theme.colors.bubbleOwnMuted },
                        ]}
                    >
                        09:42 ✓✓
                    </AppText>
                </View>
            </View>
        </View>
    );
}

/* ── Building blocks ────────────────────────────────────────────────────── */

function Section({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.section}>
            <AppText style={styles.sectionTitle}>{title}</AppText>
            {subtitle !== undefined && (
                <AppText style={styles.sectionSubtitle}>{subtitle}</AppText>
            )}
            <View style={styles.sectionBody}>{children}</View>
        </View>
    );
}

function Label({
    text,
    hint,
}: {
    text: string;
    hint?: string;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.labelRow}>
            <AppText style={styles.label}>{text}</AppText>
            {hint !== undefined && (
                <AppText style={styles.labelHint}>{hint}</AppText>
            )}
        </View>
    );
}

function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: readonly { id: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    return (
        <View style={styles.segmented}>
            {options.map((option) => {
                const selected = option.id === value;
                return (
                    <Pressable
                        key={option.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={(): void => onChange(option.id)}
                        style={[
                            styles.segment,
                            selected && {
                                backgroundColor: theme.colors.accentSoft,
                                borderColor: theme.colors.accentBorder,
                            },
                        ]}
                    >
                        <AppText
                            style={[
                                styles.segmentLabel,
                                {
                                    color: selected
                                        ? theme.colors.text
                                        : theme.colors.textSecondary,
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {option.label}
                        </AppText>
                    </Pressable>
                );
            })}
        </View>
    );
}

/* ── Blur & dim controls ───────────────────────────────────────────────── */

/**
 * Only the preview subscribes to the in-flight slider values, so a drag
 * re-renders this small layer (and not the screen or the store).
 */
function PreviewBackground(): React.ReactElement {
    const preview = useAppBackgroundPreview();
    return <AppBackgroundLayer preview={preview} />;
}

function BackgroundEffects({
    background,
    onChange,
}: {
    background: AppBackground;
    onChange: (background: AppBackground) => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    const enabled = background.kind === 'image';

    // The saved background is the source of truth as soon as it changes, and
    // no live value may outlive the screen.
    useEffect((): void => {
        clearAppBackgroundPreview();
    }, [background]);
    useEffect((): (() => void) => clearAppBackgroundPreview, []);

    const blur =
        background.kind === 'image' ? background.blur : DEFAULT_IMAGE_BLUR;
    const dim =
        background.kind === 'image' ? background.dim : DEFAULT_IMAGE_DIM;

    const preview = (next: { blur: number; dim: number }): void => {
        if (enabled) {
            setAppBackgroundPreview(next);
        }
    };

    const commit = (next: Partial<{ blur: number; dim: number }>): void => {
        if (background.kind !== 'image') {
            return;
        }
        // Persist first, then drop the preview override: the saved value is
        // already in place when the layer falls back to the store.
        onChange({ ...background, ...next });
        clearAppBackgroundPreview();
    };

    return (
        <View style={styles.effects}>
            {!enabled && (
                <View style={styles.effectsHint}>
                    <Info
                        size={14}
                        color={theme.colors.textMuted}
                        strokeWidth={2}
                    />
                    <SafeText lines={2} style={styles.effectsHintText}>
                        Available for image backgrounds
                    </SafeText>
                </View>
            )}

            <EffectCard
                icon={
                    <Droplets
                        size={16}
                        color={theme.colors.text}
                        strokeWidth={2}
                    />
                }
                title="Blur"
                description="Softens the photo behind the app."
                value={blurToPercent(blur)}
                defaultValue={blurToPercent(DEFAULT_IMAGE_BLUR)}
                disabled={!enabled}
                onChange={(percent): void => {
                    preview({ blur: percentToBlur(percent), dim });
                }}
                onCommit={(percent): void => {
                    commit({ blur: percentToBlur(percent) });
                }}
            />

            <EffectCard
                icon={
                    <Moon size={16} color={theme.colors.text} strokeWidth={2} />
                }
                title="Dim"
                description="Darkens the photo so text stays readable."
                value={dimToPercent(dim)}
                defaultValue={dimToPercent(DEFAULT_IMAGE_DIM)}
                disabled={!enabled}
                onChange={(percent): void => {
                    preview({ blur, dim: percentToDim(percent) });
                }}
                onCommit={(percent): void => {
                    commit({ dim: percentToDim(percent) });
                }}
            />
        </View>
    );
}

function EffectCard({
    icon,
    title,
    description,
    value,
    defaultValue,
    disabled,
    onChange,
    onCommit,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    value: number;
    defaultValue: number;
    disabled: boolean;
    onChange: (percent: number) => void;
    onCommit: (percent: number) => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    // Live value while dragging; `null` means "use the saved value".
    const [live, setLive] = useState<number | null>(null);
    const percent = live ?? value;
    const changed = Math.abs(percent - defaultValue) >= 0.5;

    const handleCommit = (next: number): void => {
        onCommit(next);
        setLive(null);
    };

    const handleReset = (): void => {
        onChange(defaultValue);
        handleCommit(defaultValue);
    };

    return (
        <View
            style={[styles.effectCard, disabled && styles.effectCardDisabled]}
        >
            <View style={styles.effectHeader}>
                <View style={styles.effectIcon}>{icon}</View>
                <View style={styles.effectText}>
                    <View style={styles.effectTitleRow}>
                        <AppText style={styles.effectTitle}>{title}</AppText>
                    </View>
                    <SafeText lines={2} style={styles.effectDescription}>
                        {description}
                    </SafeText>
                </View>
                <View style={styles.effectBadge}>
                    <SafeText style={styles.effectBadgeText}>
                        {`${Math.round(percent)}%`}
                    </SafeText>
                </View>
            </View>

            <AppValueSlider
                label={title}
                value={percent}
                disabled={disabled}
                onChange={(next): void => {
                    setLive(next);
                    onChange(next);
                }}
                onCommit={handleCommit}
            />

            {changed && (
                <Animated.View
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(120)}
                    style={styles.effectResetRow}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Reset ${title}`}
                        hitSlop={8}
                        onPress={handleReset}
                        style={({ pressed }) => [
                            styles.effectResetButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <RotateCcw
                            size={12}
                            color={theme.colors.textSecondary}
                            strokeWidth={2}
                        />
                        <AppText style={styles.effectResetText}>Reset</AppText>
                    </Pressable>
                </Animated.View>
            )}
        </View>
    );
}

function BubbleColors({
    value,
    onChange,
}: {
    value: string | null;
    onChange: (color: string | null) => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    return (
        <View style={styles.swatchRow}>
            {BUBBLE_COLOR_PRESETS.map((preset) => {
                const selected = preset.value === value;
                const background =
                    preset.value ??
                    (theme.isDark
                        ? theme.colors.surfaceElevated
                        : theme.colors.surface);
                return (
                    <Pressable
                        key={preset.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${preset.label} bubble color`}
                        accessibilityState={{ selected }}
                        onPress={(): void => onChange(preset.value)}
                        style={[
                            styles.colorChip,
                            {
                                backgroundColor: background,
                                borderColor: selected
                                    ? theme.accent
                                    : theme.colors.border,
                            },
                            selected && styles.colorChipSelected,
                        ]}
                    >
                        {preset.value === null ? (
                            <AppText
                                style={[
                                    styles.autoLabel,
                                    { color: theme.colors.textSecondary },
                                ]}
                            >
                                Auto
                            </AppText>
                        ) : (
                            selected && (
                                <Check
                                    size={15}
                                    color={readableTextColor(
                                        preset.value,
                                    )}
                                    strokeWidth={3}
                                />
                            )
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

function BackgroundPicker({
    value,
    custom,
    onChange,
    onPickImage,
    onRemoveImage,
    picking,
}: {
    value: AppBackground;
    custom: CustomAppBackground | null;
    onChange: (background: AppBackground) => void;
    onPickImage: () => void;
    onRemoveImage: () => void;
    picking: boolean;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    // Re-selecting the stored photo keeps the blur/dim the user chose for it.
    const imageBlur = value.kind === 'image' ? value.blur : DEFAULT_IMAGE_BLUR;
    const imageDim = value.kind === 'image' ? value.dim : DEFAULT_IMAGE_DIM;

    const isSelected = (background: AppBackground): boolean => {
        if (background.kind !== value.kind) {
            return false;
        }
        if (background.kind === 'pattern' && value.kind === 'pattern') {
            return background.id === value.id;
        }
        if (background.kind === 'gradient' && value.kind === 'gradient') {
            return background.id === value.id;
        }
        if (background.kind === 'solid' && value.kind === 'solid') {
            return background.color === value.color;
        }
        if (background.kind === 'image' && value.kind === 'image') {
            return background.id === value.id;
        }
        // `default` and `circles` carry no payload, so kind equality is enough.
        return background.kind === 'default' || background.kind === 'circles';
    };

    const customSelected =
        custom !== null &&
        isSelected({
            kind: 'image',
            id: custom.id,
            blur: imageBlur,
            dim: imageDim,
        });

    const tileStyle = (selected: boolean) => [
        styles.bgTile,
        {
            borderColor: selected
                ? theme.accent
                : theme.colors.border,
        },
    ];

    return (
        <View style={styles.bgGrid}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Default background"
                accessibilityState={{ selected: value.kind === 'default' }}
                onPress={(): void => onChange({ kind: 'default' })}
                style={tileStyle(value.kind === 'default')}
            >
                <View
                    style={[
                        styles.bgTileFill,
                        {
                            backgroundColor: theme.colors.background,
                        },
                    ]}
                />
                <AppText style={styles.bgTileLabel}>Default</AppText>
            </Pressable>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Circles background"
                accessibilityState={{
                    selected: value.kind === 'circles',
                }}
                onPress={(): void => onChange({ kind: 'circles' })}
                style={tileStyle(value.kind === 'circles')}
            >
                <View
                    style={[
                        styles.bgTileFill,
                        {
                            backgroundColor: theme.colors.background,
                        },
                    ]}
                >
                    <View
                        style={[
                            styles.circleTileTop,
                            { backgroundColor: theme.colors.accentSoft },
                        ]}
                    />
                    <View
                        style={[
                            styles.circleTileBottom,
                            { backgroundColor: theme.colors.glassAccent },
                        ]}
                    />
                </View>
                <AppText style={styles.bgTileLabel}>Circles</AppText>
            </Pressable>

            {PATTERN_OPTIONS.map((pattern) => (
                <Pressable
                    key={pattern.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${pattern.label} pattern`}
                    accessibilityState={{
                        selected: isSelected({
                            kind: 'pattern',
                            id: pattern.id,
                        }),
                    }}
                    onPress={(): void =>
                        onChange({ kind: 'pattern', id: pattern.id })
                    }
                    style={tileStyle(
                        isSelected({ kind: 'pattern', id: pattern.id }),
                    )}
                >
                    <PatternPreview id={pattern.id} />
                    <AppText style={styles.bgTileLabel}>{pattern.label}</AppText>
                </Pressable>
            ))}

            {GRADIENT_PRESETS.map((gradient) => (
                <Pressable
                    key={`gradient-${gradient.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${gradient.label} gradient`}
                    accessibilityState={{
                        selected: isSelected({
                            kind: 'gradient',
                            id: gradient.id,
                        }),
                    }}
                    onPress={(): void =>
                        onChange({ kind: 'gradient', id: gradient.id })
                    }
                    style={tileStyle(
                        isSelected({ kind: 'gradient', id: gradient.id }),
                    )}
                >
                    <LinearGradient
                        colors={[...gradient.colors]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.bgTileFill}
                    />
                    <AppText style={styles.bgTileLabel}>{gradient.label}</AppText>
                </Pressable>
            ))}

            {SOLID_BACKGROUND_PRESETS.map((solid) => (
                <Pressable
                    key={`solid-${solid.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${solid.label} background`}
                    accessibilityState={{
                        selected: isSelected({
                            kind: 'solid',
                            color: solid.value,
                        }),
                    }}
                    onPress={(): void =>
                        onChange({ kind: 'solid', color: solid.value })
                    }
                    style={tileStyle(
                        isSelected({ kind: 'solid', color: solid.value }),
                    )}
                >
                    <View
                        style={[
                            styles.bgTileFill,
                            colorFill(solid.value),
                        ]}
                    />
                    <AppText style={styles.bgTileLabel}>{solid.label}</AppText>
                </Pressable>
            ))}

            {custom !== null && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Stored background photo"
                    accessibilityState={{ selected: customSelected }}
                    onPress={(): void =>
                        onChange({
                            kind: 'image',
                            id: custom.id,
                            blur: imageBlur,
                            dim: imageDim,
                        })
                    }
                    style={tileStyle(customSelected)}
                >
                    <View
                        style={[
                            styles.bgTileFill,
                            { backgroundColor: theme.colors.surfaceElevated },
                        ]}
                    >
                        <Image
                            source={{ uri: custom.thumbnailUri }}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={custom.thumbnailUri}
                            transition={0}
                            style={styles.bgTileThumb}
                            accessibilityIgnoresInvertColors={true}
                        />
                    </View>
                    <AppText style={styles.bgTileLabel}>My photo</AppText>
                </Pressable>
            )}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose a background image"
                accessibilityState={{ selected: custom === null && value.kind === 'image' }}
                disabled={picking}
                onPress={onPickImage}
                style={tileStyle(custom === null && value.kind === 'image')}
            >
                <View
                    style={[
                        styles.bgTileFill,
                        styles.bgTileImage,
                        { backgroundColor: theme.colors.accentSoft },
                    ]}
                >
                    <ImagePlus size={18} color={theme.colors.text} />
                </View>
                <AppText style={styles.bgTileLabel}>
                    {picking
                        ? 'Opening…'
                        : custom === null
                          ? 'Photo'
                          : 'Replace'}
                </AppText>
            </Pressable>

            {custom !== null && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove background photo"
                    onPress={onRemoveImage}
                    style={tileStyle(false)}
                >
                    <View
                        style={[
                            styles.bgTileFill,
                            styles.bgTileImage,
                            { backgroundColor: theme.colors.dangerSoft },
                        ]}
                    >
                        <Trash2 size={18} color={theme.colors.danger} />
                    </View>
                    <AppText style={styles.bgTileLabel}>Remove</AppText>
                </Pressable>
            )}
        </View>
    );
}

function PatternPreview({
    id,
}: {
    id: 'dots' | 'grid' | 'diagonal';
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const theme = useTheme();
    const tint = theme.colors.patternTint;
    return (
        <View
            style={[
                styles.bgTileFill,
                { backgroundColor: theme.colors.backgroundAlt },
            ]}
        >
            {id === 'dots' ? (
                <View style={styles.patternDots}>
                    {Array.from({ length: 15 }, (_, index) => (
                        <View
                            key={index}
                            style={[
                                styles.patternDot,
                                { backgroundColor: tint },
                            ]}
                        />
                    ))}
                </View>
            ) : (
                <View style={styles.patternLines}>
                    {Array.from({ length: 4 }, (_, index) => (
                        <View
                            key={index}
                            style={[
                                styles.patternLine,
                                {
                                    backgroundColor: tint,
                                    transform: [
                                        {
                                            rotate:
                                                id === 'diagonal'
                                                    ? '45deg'
                                                    : '0deg',
                                        },
                                    ],
                                },
                            ]}
                        />
                    ))}
                </View>
            )}
        </View>
    );
}

const createStyles = (theme: AppTheme) => {
    const font = fontOption(theme.fontId).families;
    return StyleSheet.create({
        // Absolute chrome over the full-bleed scroll view (same layer the
        // chats list uses); paddingTop keeps the glass clear of the status bar.
        headerLayer: {
            position: 'absolute',
            top: 0,
            start: 0,
            end: 0,
            gap: spacing.xxs,
        },
        // The horizontal gutter lives inside the scroll view now, so the fade
        // mask spans the full screen width; the wrapper owns the vertical
        // padding (header / safe area) so it matches the fade exactly.
        scroll: {
            paddingHorizontal: spacing.md,
            gap: spacing.md,
        },
        backButton: {
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
        },
        pressed: { opacity: 0.6 },
        previewCard: {
            height: 280,
            borderRadius: radii.lg,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.background,
        },
        previewInner: {
            flex: 1,
            padding: spacing.sm,
            justifyContent: 'flex-start',
            gap: 6,
        },
        previewAppBar: {
            paddingBottom: 6,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        previewAppTitle: { fontSize: 13, fontWeight: '700' },
        previewListRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 7,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
        },
        previewAvatar: { width: 24, height: 24, borderRadius: 12 },
        previewListBody: { flex: 1, minWidth: 0, gap: 1 },
        previewListName: { fontSize: 11.5, fontWeight: '700' },
        previewListPreview: { fontSize: 10 },
        previewSpacer: { flex: 1 },
        previewPill: {
            alignSelf: 'center',
            paddingHorizontal: spacing.sm,
            paddingVertical: 3,
            borderRadius: radii.full,
            borderWidth: StyleSheet.hairlineWidth,
            marginBottom: spacing.xxs,
        },
        previewPillText: { fontSize: 10.5, fontWeight: '600' },
        previewBubble: {
            maxWidth: '82%',
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderWidth: StyleSheet.hairlineWidth,
        },
        previewTheirs: { alignSelf: 'flex-start' },
        previewMine: { alignSelf: 'flex-end' },
        previewMeta: {
            fontSize: 9.5,
            marginTop: 2,
            alignSelf: 'flex-end',
        },
        previewMetaMine: { opacity: 0.9 },
        section: {
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.glassSurface,
            padding: spacing.md,
            gap: spacing.xs,
        },
        sectionTitle: {
            fontSize: 15,
            fontWeight: '700',
            color: theme.colors.text,
            fontFamily: font?.bold,
        },
        sectionSubtitle: {
            fontSize: 12,
            color: theme.colors.textSecondary,
            marginBottom: spacing.xxs,
            fontFamily: font?.regular,
        },
        sectionBody: { gap: spacing.sm },
        labelRow: { gap: 1, marginTop: spacing.xxs },
        label: {
            fontSize: 12.5,
            fontWeight: '600',
            color: theme.colors.text,
            fontFamily: font?.medium,
        },
        labelHint: {
            fontSize: 11,
            color: theme.colors.textMuted,
            fontFamily: font?.regular,
        },
        segmented: {
            flexDirection: 'row',
            gap: 4,
            flexWrap: 'wrap',
        },
        segment: {
            flexGrow: 1,
            flexBasis: '22%',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 8,
            paddingHorizontal: 6,
            borderRadius: radii.sm,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        segmentLabel: {
            fontSize: 12,
            fontWeight: '600',
            fontFamily: font?.medium,
        },
        swatchRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.xs,
            alignItems: 'center',
        },
        swatch: {
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
        },
        swatchSelected: {
            borderWidth: 2,
            borderColor: theme.colors.text,
        },
        colorChip: {
            minWidth: 44,
            height: 34,
            paddingHorizontal: 8,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
        },
        colorChipSelected: { borderWidth: 2 },
        autoLabel: { fontSize: 11, fontWeight: '600' },
        effects: { gap: spacing.xs, marginTop: spacing.xxs },
        effectsHint: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        effectsHintText: {
            fontSize: 11,
            color: theme.colors.textMuted,
            fontFamily: font?.regular,
        },
        effectCard: {
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: spacing.sm,
            paddingTop: spacing.sm,
            paddingBottom: spacing.xs,
            gap: 2,
        },
        effectCardDisabled: { opacity: 0.6 },
        effectHeader: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.sm,
        },
        effectIcon: {
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.accentSoft,
        },
        effectText: { flex: 1, minWidth: 0, gap: 1 },
        effectTitleRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
        },
        effectTitle: {
            fontSize: 13.5,
            fontWeight: '700',
            color: theme.colors.text,
            fontFamily: font?.medium,
        },
        effectPersian: {
            fontSize: 12,
            color: theme.colors.textMuted,
            fontFamily: font?.regular,
        },
        effectDescription: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            fontFamily: font?.regular,
        },
        effectBadge: {
            flexShrink: 0,
            minWidth: 48,
            alignItems: 'center',
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: radii.full,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
            backgroundColor: theme.colors.accentSoft,
        },
        effectBadgeText: {
            fontSize: 11.5,
            fontWeight: '700',
            color: theme.colors.text,
        },
        effectResetRow: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            marginTop: 2,
        },
        effectResetButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingVertical: 4,
            paddingHorizontal: 2,
        },
        effectResetText: {
            fontSize: 11,
            fontWeight: '600',
            color: theme.colors.textSecondary,
            fontFamily: font?.medium,
        },
        scalePreview: { paddingVertical: spacing.xxs },
        scaleBubble: {
            alignSelf: 'flex-start',
            maxWidth: '92%',
            borderRadius: radii.md,
            borderWidth: 1,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
        },
        fontRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.xs,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: 'transparent',
        },
        fontRowSelected: {
            borderColor: theme.colors.accentBorder,
            backgroundColor: theme.colors.accentSoft,
        },
        fontBody: { flex: 1, minWidth: 0, gap: 2 },
        fontName: { fontSize: 15, fontWeight: '700' },
        fontPreview: { fontSize: 13 },
        fontMeta: {
            fontSize: 10.5,
            fontWeight: '400',
        },
        radio: {
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
        },
        radioDot: { width: 10, height: 10, borderRadius: 5 },
        resetButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            paddingVertical: spacing.sm,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        resetLabel: {
            fontSize: 14,
            fontWeight: '600',
            fontFamily: font?.medium,
        },
        persianHint: {
            fontSize: 11,
            textAlign: 'center',
        },
        bgGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.xs,
        },
        bgTile: {
            width: '30%',
            borderRadius: radii.sm,
            borderWidth: 1.5,
            overflow: 'hidden',
            paddingBottom: 4,
            gap: 3,
        },
        bgTileFill: {
            height: 44,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
        },
        bgTileImage: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
        },
        // Explicit box: the thumbnail must never render at 0×0 inside the tile.
        bgTileThumb: {
            width: '100%',
            height: '100%',
        },
        // Miniature of the two background circles, matching the real layer.
        circleTileTop: {
            position: 'absolute',
            top: -18,
            end: -14,
            width: 40,
            height: 40,
            borderRadius: 20,
        },
        circleTileBottom: {
            position: 'absolute',
            bottom: -22,
            start: -16,
            width: 44,
            height: 44,
            borderRadius: 22,
        },
        bgTileLabel: {
            fontSize: 10,
            color: theme.colors.textSecondary,
            textAlign: 'center',
        },
        patternDots: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            padding: 6,
            width: '100%',
        },
        patternDot: { width: 3, height: 3, borderRadius: 2 },
        patternLines: {
            width: '100%',
            height: '100%',
            justifyContent: 'space-evenly',
            paddingHorizontal: 4,
        },
        patternLine: { height: 1, width: '100%' },
    });
};
