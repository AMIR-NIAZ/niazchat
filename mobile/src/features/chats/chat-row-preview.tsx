import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { palette } from '../../shared/theme';
import { ChatRowContent } from './chat-row-content';
import type { ChatPreview } from './chats-model';

/**
 * Lifted chat row over the popup backdrop: the same content as the live row,
 * with the row's elevated card treatment so it reads as "picked up". No live
 * updates, no child components with effects.
 */
/** Memoized: the popup must not rebuild the preview during its animation. */
export const ChatRowPreview = memo(function ChatRowPreview({
    chat,
    pinned,
    previewText,
    width,
}: {
    chat: ChatPreview;
    pinned: boolean;
    previewText: string;
    width: number;
}): React.ReactElement {
    return (
        <View pointerEvents="none" style={[styles.card, { width }]}>
            <ChatRowContent
                chat={chat}
                pinned={pinned}
                previewText={previewText}
            />
        </View>
    );
});

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.elevated,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.strong,
        shadowColor: '#7545B8',
        shadowOpacity: 0.35,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
    },
});
