import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from '../components/app-text';
import { palette, spacing } from '../theme';
import { DialogButtons } from './dialog-buttons';
import { TONE_STYLES } from './dialog-tones';
import type { DialogButton, DialogTone } from './dialog-types';

/** ~6 lines of body copy before the message starts scrolling. */
const MESSAGE_MAX_HEIGHT = 6 * 21;

interface DialogCardProps {
    title: string;
    message: string | null;
    tone: DialogTone;
    buttons: readonly DialogButton[];
    busyIndex: number | null;
    width: number;
    /** Scale / translate for the bubble entrance and exit. */
    cardStyle: StyleProp<AnimatedStyle<ViewStyle>>;
    /** The tone badge's pop. */
    iconStyle: StyleProp<AnimatedStyle<ViewStyle>>;
    onButtonPress: (button: DialogButton, index: number) => void;
}

/**
 * Themed dialog card: icon badge, centered title, at-most-six-line scrollable
 * message, then the button row. The card is a memoized leaf — the host only
 * hands it Reanimated styles, so the exit animation never re-renders content.
 *
 * Text is centered with automatic writing direction, so Persian strings and
 * mixed LTR fragments wrap without clipping.
 */
export const DialogCard = memo(function DialogCard({
    title,
    message,
    tone,
    buttons,
    busyIndex,
    width,
    cardStyle,
    iconStyle,
    onButtonPress,
}: DialogCardProps): React.ReactElement {
    const toneStyle = TONE_STYLES[tone];
    const Icon = toneStyle.icon;

    return (
        <Animated.View
            style={[styles.card, { width }, cardStyle]}
            accessibilityViewIsModal={true}
        >
            <LinearGradient
                pointerEvents="none"
                colors={['#1A1127', palette.surface]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            <View
                accessible={true}
                accessibilityRole="alert"
                accessibilityLabel={
                    message === null ? title : `${title}. ${message}`
                }
                style={styles.header}
            >
                <Animated.View
                    style={[
                        styles.badge,
                        { backgroundColor: toneStyle.wash },
                        iconStyle,
                    ]}
                >
                    <Icon size={26} strokeWidth={2} color={toneStyle.color} />
                </Animated.View>
                <AppText style={styles.title}>{title}</AppText>
            </View>
            {message !== null && (
                <ScrollView
                    style={styles.messageScroll}
                    contentContainerStyle={styles.messageContent}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled={true}
                >
                    <AppText style={styles.message}>{message}</AppText>
                </ScrollView>
            )}
            <DialogButtons
                buttons={buttons}
                busyIndex={busyIndex}
                onPress={onButtonPress}
            />
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    card: {
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        gap: spacing.md,
        overflow: 'hidden',
        backgroundColor: palette.surface,
        shadowColor: '#7545B8',
        shadowOpacity: 0.45,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 14 },
        elevation: 24,
    },
    header: {
        alignItems: 'center',
        gap: spacing.sm,
    },
    badge: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: -0.2,
        color: palette.text.primary,
        textAlign: 'center',
        writingDirection: 'auto',
    },
    messageScroll: { maxHeight: MESSAGE_MAX_HEIGHT },
    messageContent: { paddingVertical: 0 },
    message: {
        fontSize: 15,
        lineHeight: 21,
        color: palette.text.secondary,
        textAlign: 'center',
        writingDirection: 'auto',
    },
});
