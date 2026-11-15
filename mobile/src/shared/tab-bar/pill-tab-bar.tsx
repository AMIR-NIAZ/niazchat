import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { House, Settings, UserRound, UsersRound } from 'lucide-react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { palette, radii, shadows } from '../theme';
import {
    TAB_BAR_BOTTOM_MIN,
    TAB_BAR_BOTTOM_OFFSET,
    TAB_BAR_HEIGHT,
    TAB_BAR_MAX_WIDTH,
    TAB_BAR_SIDE_MARGIN,
} from './tab-bar-inset';
import { useTotalUnread } from './use-total-unread';
import { requestHomeTabReselect } from './tab-bar-events';

/**
 * Floating, purple, pill-shaped bottom tab bar.
 *
 * - Four equal slots; a spring-driven highlight slides beneath the active tab
 *   and is slightly wider than the slot, so the active tab reads as expanded
 *   while its icon + label sit side by side (the label width animates on the
 *   UI thread, so nothing re-renders per frame).
 * - Entrance, keyboard hide/show, press scale, tab bounce and the unread badge
 *   pop are all shared values; only the screen itself re-renders on a tab
 *   change.
 * - Reduce Motion collapses every spring to a 90 ms fade.
 */

interface TabIconProps {
    size?: number;
    color?: string;
    strokeWidth?: number;
    fill?: string;
}

interface TabConfig {
    /** Route name inside `(app)/(tabs)`. */
    name: string;
    label: string;
    icon: React.ComponentType<TabIconProps>;
    /** Estimated label width (dp) used for the expand animation. */
    labelWidth: number;
}

/** Visual left → right order. Home is the initial route but sits third. */
const TAB_ORDER: readonly TabConfig[] = [
    {
        name: 'profile',
        label: 'Profile',
        icon: UserRound,
        labelWidth: 44,
    },
    {
        name: 'contacts',
        label: 'Contacts',
        icon: UsersRound,
        labelWidth: 50,
    },
    {
        name: 'index',
        label: 'Home',
        icon: House,
        labelWidth: 36,
    },
    {
        name: 'settings',
        label: 'Settings',
        icon: Settings,
        labelWidth: 48,
    },
];

const INDICATOR_SPRING = { damping: 18, stiffness: 220, mass: 0.8 };
const ENTRANCE_SPRING = { damping: 16, stiffness: 150, mass: 0.9 };
const PRESS_SPRING = { damping: 20, stiffness: 300, mass: 0.6 };
const REDUCED_MS = 90;
/** How much wider than its slot the active highlight is. */
const ACTIVE_EXTRA_WIDTH = 18;
const INACTIVE_ICON = 'rgba(255,255,255,0.6)';

function PillTabBarBase(props: BottomTabBarProps): React.ReactElement {
    const { state } = props;
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const unread = useTotalUnread();

    // Stable handlers: the bar is memo'd, so callbacks must not close over the
    // fresh `state`/`navigation` objects on every navigation.
    const propsRef = useRef(props);
    propsRef.current = props;

    const [rowWidth, setRowWidth] = useState(0);
    const indicatorX = useSharedValue(0);
    const indicatorW = useSharedValue(0);
    const entrance = useSharedValue(80);
    const hidden = useSharedValue(0);
    const laidOutRef = useRef(false);

    const activeIndex = useMemo((): number => {
        const activeName = state.routes[state.index]?.name;
        const found = TAB_ORDER.findIndex((tab) => tab.name === activeName);
        return found === -1 ? 0 : found;
    }, [state.index, state.routes]);

    // Entrance: slide up + fade in once, when the tab group mounts.
    useEffect((): void => {
        entrance.value = reduceMotion
            ? withTiming(0, { duration: REDUCED_MS })
            : withSpring(0, ENTRANCE_SPRING);
    }, [entrance, reduceMotion]);

    // Keyboard: get out of the way while typing, come back afterwards.
    useEffect((): (() => void) => {
        const show = Keyboard.addListener('keyboardDidShow', (): void => {
            hidden.value = withTiming(1, {
                duration: reduceMotion ? REDUCED_MS : 220,
            });
        });
        const hide = Keyboard.addListener('keyboardDidHide', (): void => {
            hidden.value = withTiming(0, {
                duration: reduceMotion ? REDUCED_MS : 220,
            });
        });
        return (): void => {
            show.remove();
            hide.remove();
        };
    }, [hidden, reduceMotion]);

    // Slide the highlight to the active slot (and grow it to the expanded
    // width). Skipped until the row has been measured.
    useEffect((): void => {
        if (rowWidth <= 0) {
            return;
        }
        const slot = rowWidth / TAB_ORDER.length;
        const width = slot + ACTIVE_EXTRA_WIDTH;
        const x = activeIndex * slot + (slot - width) / 2;
        if (!laidOutRef.current) {
            laidOutRef.current = true;
            indicatorX.value = x;
            indicatorW.value = width;
            return;
        }
        if (reduceMotion) {
            indicatorX.value = withTiming(x, { duration: REDUCED_MS });
            indicatorW.value = withTiming(width, { duration: REDUCED_MS });
            return;
        }
        indicatorX.value = withSpring(x, INDICATOR_SPRING);
        indicatorW.value = withSpring(width, INDICATOR_SPRING);
    }, [activeIndex, indicatorW, indicatorX, reduceMotion, rowWidth]);

    const handleLayout = useCallback((event: LayoutChangeEvent): void => {
        setRowWidth(event.nativeEvent.layout.width);
    }, []);

    const handleSelect = useCallback((index: number): void => {
        const tab = TAB_ORDER[index];
        if (tab === undefined) {
            return;
        }
        const current = propsRef.current;
        const route = current.state.routes.find(
            (item): boolean => item.name === tab.name,
        );
        if (route === undefined) {
            return;
        }
        const isFocused =
            current.state.routes[current.state.index]?.key === route.key;
        const event = current.emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
        });
        if (!isFocused && !event.defaultPrevented) {
            try {
                void Haptics.selectionAsync();
            } catch {
                // Haptics are unavailable on some devices / simulators.
            }
            current.navigateToTab(route.key);
            return;
        }
        if (isFocused && tab.name === 'index') {
            requestHomeTabReselect();
        }
    }, []);

    const wrapStyle = useAnimatedStyle(() => ({
        opacity:
            interpolate(entrance.value, [0, 80], [1, 0]) * (1 - hidden.value),
        transform: [{ translateY: entrance.value + hidden.value * 120 }],
    }));

    const indicatorStyle = useAnimatedStyle(() => ({
        width: indicatorW.value,
        transform: [{ translateX: indicatorX.value }],
    }));

    return (
        <Animated.View
            pointerEvents="box-none"
            style={[
                styles.wrap,
                {
                    bottom:
                        Math.max(insets.bottom, TAB_BAR_BOTTOM_MIN) +
                        TAB_BAR_BOTTOM_OFFSET,
                },
                wrapStyle,
            ]}
        >
            <View
                style={styles.bar}
                accessibilityRole="tablist"
                accessibilityLabel="Main navigation"
            >
                <LinearGradient
                    colors={['#2F1B4A', '#150C22']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />
                <View style={styles.inner} onLayout={handleLayout}>
                    <Animated.View
                        pointerEvents="none"
                        style={[styles.indicator, indicatorStyle]}
                    >
                        <LinearGradient
                            colors={[
                                palette.primary[500],
                                palette.primary[600],
                            ]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFill}
                        />
                    </Animated.View>
                    {TAB_ORDER.map((tab, index) => {
                        const route = state.routes.find(
                            (item): boolean => item.name === tab.name,
                        );
                        if (route === undefined) {
                            return null;
                        }
                        return (
                            <TabButton
                                key={tab.name}
                                tab={tab}
                                index={index}
                                active={index === activeIndex}
                                badge={tab.name === 'index' ? unread : 0}
                                reduceMotion={reduceMotion}
                                onSelect={handleSelect}
                            />
                        );
                    })}
                </View>
            </View>
        </Animated.View>
    );
}

interface TabButtonProps {
    tab: TabConfig;
    index: number;
    active: boolean;
    badge: number;
    reduceMotion: boolean;
    onSelect: (index: number) => void;
}

const TabButton = memo(function TabButton({
    tab,
    index,
    active,
    badge,
    reduceMotion,
    onSelect,
}: TabButtonProps): React.ReactElement {
    const press = useSharedValue(1);
    const bounce = useSharedValue(1);
    const label = useSharedValue(active ? 1 : 0);
    const badgeScale = useSharedValue(1);
    const Icon = tab.icon;

    useEffect((): void => {
        const target = active ? 1 : 0;
        label.value = reduceMotion
            ? withTiming(target, { duration: REDUCED_MS })
            : withTiming(target, { duration: 200 });
    }, [active, label, reduceMotion]);

    // Small icon bounce when this tab becomes active.
    useEffect((): void => {
        if (!active) {
            return;
        }
        if (reduceMotion) {
            bounce.value = 1;
            return;
        }
        bounce.value = withSequence(
            withTiming(1.18, { duration: 110 }),
            withTiming(1, { duration: 140 }),
        );
    }, [active, bounce, reduceMotion]);

    // Badge pop whenever the unread number changes while visible.
    useEffect((): void => {
        if (badge <= 0 || reduceMotion) {
            badgeScale.value = 1;
            return;
        }
        badgeScale.value = withSequence(
            withTiming(1.28, { duration: 120 }),
            withTiming(1, { duration: 160 }),
        );
    }, [badge, badgeScale, reduceMotion]);

    const contentStyle = useAnimatedStyle(() => ({
        transform: [{ scale: press.value * bounce.value }],
    }));

    const labelStyle = useAnimatedStyle(() => ({
        width: tab.labelWidth * label.value,
        opacity: label.value,
        transform: [{ translateX: interpolate(label.value, [0, 1], [-4, 0]) }],
    }));

    const badgeStyle = useAnimatedStyle(() => ({
        transform: [{ scale: badgeScale.value }],
    }));

    const iconSize = tab.name === 'index' ? 26 : 23;
    const iconColor = active ? palette.text.onAccent : INACTIVE_ICON;

    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            hitSlop={8}
            onPress={(): void => onSelect(index)}
            onPressIn={(): void => {
                press.value = reduceMotion
                    ? withTiming(0.94, { duration: REDUCED_MS })
                    : withSpring(0.92, PRESS_SPRING);
            }}
            onPressOut={(): void => {
                press.value = reduceMotion
                    ? withTiming(1, { duration: REDUCED_MS })
                    : withSpring(1, PRESS_SPRING);
            }}
            style={styles.tab}
        >
            <Animated.View style={[styles.tabContent, contentStyle]}>
                <View style={styles.iconWrap}>
                    <Icon
                        size={iconSize}
                        color={iconColor}
                        strokeWidth={active ? 2.4 : 2}
                        fill={active ? 'rgba(255,255,255,0.26)' : 'none'}
                    />
                    {badge > 0 ? (
                        <Animated.View
                            style={[styles.badge, badgeStyle]}
                            pointerEvents="none"
                        >
                            <Text
                                style={styles.badgeText}
                                allowFontScaling={false}
                            >
                                {badge > 99 ? '99+' : badge}
                            </Text>
                        </Animated.View>
                    ) : null}
                </View>
                <Animated.View style={[styles.labelWrap, labelStyle]}>
                    <Text
                        style={styles.label}
                        numberOfLines={1}
                        allowFontScaling={false}
                    >
                        {tab.label}
                    </Text>
                </Animated.View>
            </Animated.View>
        </Pressable>
    );
});

export const PillTabBar = memo(PillTabBarBase);

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        left: TAB_BAR_SIDE_MARGIN,
        right: TAB_BAR_SIDE_MARGIN,
        alignItems: 'center',
    },
    bar: {
        width: '100%',
        maxWidth: TAB_BAR_MAX_WIDTH,
        height: TAB_BAR_HEIGHT,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(18,13,28,0.92)',
        overflow: 'hidden',
        shadowColor: shadows.floating.shadowColor,
        shadowOpacity: 0.55,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
    },
    inner: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'stretch',
        margin: 6,
    },
    indicator: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        borderRadius: radii.full,
        overflow: 'hidden',
        backgroundColor: palette.primary[500],
    },
    tab: {
        flex: 1,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconWrap: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        position: 'absolute',
        top: -7,
        right: -11,
        minWidth: 17,
        height: 17,
        paddingHorizontal: 4,
        borderRadius: 9,
        backgroundColor: '#F06BB7',
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        color: palette.text.onAccent,
        fontSize: 9,
        fontWeight: '800',
    },
    labelWrap: {
        overflow: 'hidden',
        justifyContent: 'center',
    },
    label: {
        color: palette.text.onAccent,
        fontSize: 11,
        fontWeight: '700',
        marginStart: 5,
        width: 50,
    },
});
