import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './glass-surface';
import { useAndroidKeyboardInset } from '../hooks/use-android-keyboard-inset';
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
    // Android IME over a Modal window is not resized by `adjustResize` (the
    // dialog has its own window), so measure the overlap and move the sheet up.
    const keyboard = useAndroidKeyboardInset();
    // Animate Android's measured inset so the sheet returns smoothly instead of
    // snapping when the keyboard closes.
    const keyboardInset = useRef(new Animated.Value(0)).current;

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

    useEffect((): (() => void) => {
        const cubic = (value: number): number => Easing.cubic(value);
        const animation = Animated.timing(keyboardInset, {
            toValue: keyboard.inset,
            duration: motion.duration.normal,
            easing: Easing.out(cubic),
            useNativeDriver: false,
        });
        animation.start();
        return (): void => animation.stop();
    }, [keyboard.inset, keyboardInset]);

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
            <KeyboardAvoidingView
                style={styles.root}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                onLayout={(event): void => keyboard.onContainerLayout(event)}
            >
                <Animated.View
                    style={[styles.sheetArea, { paddingBottom: keyboardInset }]}
                >
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
                                paddingBottom: Math.max(
                                    insets.bottom,
                                    spacing.md,
                                ),
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
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    sheetArea: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(4,2,9,0.62)',
    },
    sheetWrap: {
        paddingHorizontal: spacing.xs,
        // With the keyboard open the sheet may be taller than the space left;
        // cap it so the inner ScrollView can scroll instead of clipping.
        maxHeight: '100%',
    },
    sheet: { padding: spacing.md, gap: spacing.sm, maxHeight: '100%' },
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
