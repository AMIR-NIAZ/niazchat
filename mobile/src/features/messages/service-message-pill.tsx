import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { palette, radii, spacing, motion } from '../../shared/theme';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import type { ChatMessage } from './messages-model';
import { serviceMessageParts } from './service-message';

/**
 * Telegram-style membership service message: a centered, small glass pill.
 *
 * No avatar, no time/ticks, no tail, no pressable body. Only the names inside
 * the sentence are tappable (they open the public profile). Deterministic
 * height: all content is local, never async.
 */
interface ServiceMessageProps {
    message: ChatMessage;
    currentUserId: number | null;
    /** New live arrivals get the entrance animation; history does not. */
    animate: boolean;
    onOpenProfile?: ((userId: number, name: string) => void) | undefined;
}

export function ServiceMessagePill({
    message,
    currentUserId,
    animate,
    onOpenProfile,
}: ServiceMessageProps): React.ReactElement {
    const reduceMotion = useReducedMotion();
    const entrance = useSharedValue(animate ? 0 : 1);

    useEffect((): void => {
        if (!animate) {
            return;
        }
        entrance.value = reduceMotion
            ? withTiming(1, { duration: motion.duration.normal })
            : withSpring(1, motion.springSoft);
    }, [animate, entrance, reduceMotion]);

    const animatedStyle = useAnimatedStyle(() => {
        if (reduceMotion) {
            return { opacity: entrance.value };
        }
        return {
            opacity: entrance.value,
            transform: [
                { scale: 0.9 + 0.1 * entrance.value },
                { translateY: 8 - 8 * entrance.value },
            ],
        };
    }, [reduceMotion]);

    const service = message.service;
    const fallback = message.content ?? '';
    const parts =
        service === null
            ? [{ text: fallback, userId: null, isYou: false }]
            : serviceMessageParts(service, currentUserId);

    return (
        <View style={styles.row}>
            <Reanimated.View style={[styles.pill, animatedStyle]}>
                <Text style={styles.text} numberOfLines={2}>
                    {parts.map((part, index) => {
                        const tappable =
                            part.userId !== null &&
                            part.userId > 0 &&
                            onOpenProfile !== undefined;
                        if (!tappable && !part.isYou) {
                            return (
                                <Text key={`${index}-${part.text}`}>
                                    {part.text}
                                </Text>
                            );
                        }
                        return (
                            <Text
                                key={`${index}-${part.text}`}
                                style={styles.name}
                                accessibilityRole={tappable ? 'link' : 'text'}
                                {...(tappable
                                    ? {
                                          onPress: (): void =>
                                              onOpenProfile(
                                                  part.userId as number,
                                                  part.text,
                                              ),
                                      }
                                    : {})}
                            >
                                {part.text}
                            </Text>
                        );
                    })}
                </Text>
            </Reanimated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 6,
        paddingHorizontal: spacing.md,
    },
    pill: {
        maxWidth: '80%',
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: palette.glass.systemPillBorder,
        backgroundColor: palette.glass.systemPill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    text: {
        fontSize: 12.5,
        fontWeight: '500',
        lineHeight: 17,
        textAlign: 'center',
        color: palette.text.service,
    },
    name: {
        fontWeight: '600',
        color: palette.text.serviceName,
    },
});
