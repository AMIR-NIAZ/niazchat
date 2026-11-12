import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './glass-surface';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { blur, motion, palette, radii, spacing, typography } from '../theme';

interface GlassBottomSheetProps {
    visible: boolean;
    onClose: () => void;
    /** Optional sheet title rendered above the content. */
    title?: string;
    children: React.ReactNode;
    /** Dismiss when the dimmed backdrop is pressed. Default: true. */
    dismissOnBackdrop?: boolean;
}

/**
 * Animated glass bottom sheet.
 *
 * The sheet slides and fades in on the native driver, keeps the dimmed
 * backdrop readable, and animates out before the Modal is unmounted. Reduced
 * motion mounts/unmounts without the slide.
 */
export function GlassBottomSheet({
    visible,
    onClose,
    title,
    children,
    dismissOnBackdrop = true,
}: GlassBottomSheetProps): React.ReactElement {
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const [mounted, setMounted] = useState(visible);

    useEffect((): (() => void) => {
        if (visible) {
            setMounted(true);
        }
        progress.stopAnimation();

        if (reduceMotion) {
            progress.setValue(visible ? 1 : 0);
            if (!visible) {
                setMounted(false);
            }
            return (): void => undefined;
        }

        const cubic = (value: number): number => Easing.cubic(value);
        const animation = Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: visible ? motion.duration.sheet : motion.duration.normal,
            easing: visible ? Easing.out(cubic) : Easing.in(cubic),
            useNativeDriver: true,
        });
        animation.start(({ finished }): void => {
            if (finished && !visible) {
                setMounted(false);
            }
        });
        return (): void => animation.stop();
    }, [progress, reduceMotion, visible]);

    if (!mounted) {
        return <></>;
    }

    return (
        <Modal
            visible={mounted}
            transparent={true}
            statusBarTranslucent={true}
            animationType="none"
            onRequestClose={onClose}
        >
            <View style={styles.root}>
                <Animated.View
                    style={[StyleSheet.absoluteFill, { opacity: progress }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close sheet"
                        disabled={!dismissOnBackdrop}
                        onPress={onClose}
                        style={styles.backdrop}
                    />
                </Animated.View>
                <Animated.View
                    style={[
                        styles.sheetWrap,
                        {
                            paddingBottom: Math.max(insets.bottom, spacing.md),
                            transform: [
                                {
                                    translateY: progress.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [56, 0],
                                    }),
                                },
                            ],
                            opacity: progress,
                        },
                    ]}
                >
                    <GlassSurface
                        tone="elevated"
                        intensity={blur.strong}
                        radius={radii.xl}
                        floating={true}
                        style={styles.sheet}
                    >
                        <View style={styles.grabber} />
                        {title !== undefined && (
                            <Text style={styles.title}>{title}</Text>
                        )}
                        {children}
                    </GlassSurface>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(4,2,9,0.62)',
    },
    sheetWrap: {
        paddingHorizontal: spacing.xs,
    },
    sheet: { padding: spacing.md, gap: spacing.sm },
    grabber: {
        alignSelf: 'center',
        width: 42,
        height: 4,
        borderRadius: radii.full,
        backgroundColor: palette.border.strong,
        marginBottom: spacing.xxs,
    },
    title: {
        ...typography.heading,
        textAlign: 'center',
        color: palette.text.primary,
    },
});
