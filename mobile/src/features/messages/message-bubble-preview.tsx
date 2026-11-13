import { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { MessageBubble } from './message-bubble';
import type { ChatMessage } from './messages-model';

/**
 * Static, non-interactive render of the SAME bubble, used as the lifted preview
 * over the popup backdrop. It shares `MessageBubble`'s markup so the lift is
 * seamless, but mounts no player, starts no download and runs no animation.
 */
/** Memoized: the popup must not rebuild the preview during its animation. */
export const MessageBubblePreview = memo(function MessageBubblePreview({
    message,
    mine,
    isGroup,
    currentUserId,
    showSenderName,
    showAvatar,
    width,
}: {
    message: ChatMessage;
    mine: boolean;
    isGroup: boolean;
    currentUserId: number | null;
    showSenderName: boolean;
    showAvatar: boolean;
    width: number;
}): React.ReactElement {
    return (
        <View pointerEvents="none" style={[styles.wrap, { width }]}>
            <MessageBubble
                message={message}
                mine={mine}
                isGroup={isGroup}
                currentUserId={currentUserId}
                showSenderName={showSenderName}
                showAvatar={showAvatar}
                othersLastSeenId={null}
                highlighted={false}
                selected={false}
                selectionMode={false}
                isStatic={true}
            />
        </View>
    );
});

const styles = StyleSheet.create({
    wrap: { alignSelf: 'flex-start' },
});
