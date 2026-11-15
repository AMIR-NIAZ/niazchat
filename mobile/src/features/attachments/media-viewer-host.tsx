import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AttachmentViewer } from './attachment-viewer';
import {
    finishMediaViewerSession,
    getMediaViewerSession,
    subscribeMediaViewer,
} from './media-viewer-store';

/**
 * The media viewer's ONE mount point, at the root of the app.
 *
 * It is a sibling painted AFTER the navigator, so it covers every screen and
 * everything floating over them: chat header, composer, notices, the tab bar.
 * The stacking order is navigator < media viewer (900) < context popups
 * (1000) < dialogs and toasts (1100), because this host is nested inside both
 * of those providers and only draws its own overlay.
 *
 * Nothing is mounted while it is closed — no views, no listeners, no
 * `BackHandler` — and opening/closing never re-renders a screen: the session
 * lives in a module store that only this host subscribes to.
 */
const VIEWER_Z = 900;

export function MediaViewerProvider({
    children,
}: {
    children: ReactNode;
}): React.ReactElement {
    const session = useSyncExternalStore(
        subscribeMediaViewer,
        getMediaViewerSession,
        getMediaViewerSession,
    );
    const sessionId = session?.id ?? null;

    // Opening ends text input. Closing does NOT touch the keyboard: the
    // composer decides for itself whether it wants focus back.
    useEffect((): void => {
        if (sessionId !== null) {
            Keyboard.dismiss();
        }
    }, [sessionId]);

    return (
        <>
            {children}
            {session !== null && (
                <View
                    style={styles.overlay}
                    accessibilityViewIsModal={true}
                    importantForAccessibility="yes"
                >
                    {/* Light status bar content over the viewer's dark
                        background; the root StatusBar takes over again as
                        soon as this one unmounts. */}
                    <StatusBar style="light" animated={true} />
                    <AttachmentViewer
                        key={session.id}
                        items={session.items}
                        initialIndex={session.initialIndex}
                        origin={session.origin}
                        onClose={finishMediaViewerSession}
                        onForward={session.actions.onForward}
                        onGoToMessage={session.actions.onGoToMessage}
                        onDelete={session.actions.onDelete}
                        canDelete={session.actions.canDelete}
                    />
                </View>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        bottom: 0,
        zIndex: VIEWER_Z,
        elevation: VIEWER_Z,
    },
});
