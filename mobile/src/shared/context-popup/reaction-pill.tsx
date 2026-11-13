import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii } from '../theme';
import {
    REACTION_PILL_HEIGHT,
    REACTION_PILL_MAX_SLOTS,
    REACTION_PILL_PADDING,
    REACTION_PILL_TARGET,
} from './popup-layout';

/**
 * The quick-reaction pill above (or below) the copy. Fixed geometry from
 * `popup-layout.ts`, so the host can place it without measuring.
 *
 * Memoized and driven by plain data: tapping a face closes the popup first and
 * runs the reaction afterwards (the host owns that sequencing).
 */

export interface ContextPopupReaction {
    emoji: string;
    selected: boolean;
    onPress: () => void;
}

export const ReactionPill = memo(function ReactionPill({
    reactions,
    width,
}: {
    reactions: readonly ContextPopupReaction[];
    width: number;
}): React.ReactElement {
    return (
        <View
            accessibilityViewIsModal={true}
            accessibilityLabel="Reactions"
            style={[styles.pill, { width }]}
        >
            {reactions.slice(0, REACTION_PILL_MAX_SLOTS).map((reaction) => (
                <Text
                    key={reaction.emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${reaction.emoji}`}
                    accessibilityState={{ selected: reaction.selected }}
                    onPress={reaction.onPress}
                    style={[
                        styles.target,
                        reaction.selected && styles.selected,
                        reaction.selected && styles.selectedText,
                    ]}
                >
                    {reaction.emoji}
                </Text>
            ))}
        </View>
    );
});

const styles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: REACTION_PILL_PADDING,
        height: REACTION_PILL_HEIGHT,
        borderRadius: radii.full,
        backgroundColor: palette.elevated,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.strong,
        overflow: 'hidden',
        shadowColor: '#7545B8',
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 9,
    },
    target: {
        width: REACTION_PILL_TARGET,
        height: REACTION_PILL_TARGET,
        lineHeight: REACTION_PILL_TARGET,
        textAlign: 'center',
        fontSize: 22,
        borderRadius: REACTION_PILL_TARGET / 2,
    },
    selected: {
        borderWidth: 2,
        borderColor: palette.primary[300],
        backgroundColor: palette.primary[100],
    },
    selectedText: { lineHeight: REACTION_PILL_TARGET - 4 },
});
