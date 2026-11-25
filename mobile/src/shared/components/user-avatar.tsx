import { memo, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { avatarFileNameOf, avatarThumbUrl } from '../../core/config/env';
import { AppText } from './app-text';
import { mixColors, readableTextColor } from '../theme/colors';
import { useTheme } from '../theme/theme-provider';
import { normalizeSingleLineText } from '../text-direction';

/**
 * Circular (or rounded) avatar built on `expo-image`.
 *
 * - Requests a server-generated THUMBNAIL (smallest size that covers the
 *   rendered circle × device pixel ratio), never the original file.
 * - `cachePolicy="memory-disk"` + a year-long immutable cache on the server:
 *   each avatar file is downloaded at most once per device, and never again
 *   for a re-render, a chat reopen or an app restart.
 * - `recyclingKey` is the file name, so a recycled list row swaps the image
 *   instead of briefly showing the previous sender's face.
 * - No avatar / load failure → initial(s) on a shade derived from the active
 *   accent, at the same size, so there is no gap and no layout shift.
 */

/** How far each stable shade is mixed toward the app background. */
const FALLBACK_STEPS = [0, 0.16, 0.3, 0.08, 0.24, 0.4] as const;

export function avatarFallbackColor(
    userId: number,
    accent: string,
    backdrop: string,
): string {
    const index = Math.abs(Math.trunc(userId)) % FALLBACK_STEPS.length;
    return mixColors(accent, backdrop, FALLBACK_STEPS[index] ?? 0);
}

export function avatarInitials(name: string): string {
    const words = normalizeSingleLineText(name).split(' ').filter(Boolean);
    if (words.length === 0) {
        return '؟';
    }
    // Array.from keeps an emoji (or any astral character) whole instead of
    // splitting its surrogate pair into a broken half-glyph.
    const first = Array.from(words[0] ?? '')[0] ?? '';
    const second =
        words.length > 1 ? (Array.from(words[1] ?? '')[0] ?? '') : '';
    return `${first}${second}`.toUpperCase();
}

export interface UserAvatarProps {
    /** Stable identity for the fallback color (user id, or chat id for groups). */
    userId: number;
    name: string;
    /** Server-relative path (`uploads/avatars/...`) or an absolute uploads URL. */
    uri: string | null | undefined;
    /** Rendered edge length in dp. */
    size: number;
    /** Defaults to a circle; pass e.g. `radii.md` for rounded tiles. */
    borderRadius?: number;
    /** Decorative by default: the adjacent name is what screen readers read. */
    accessibilityLabel?: string;
}

function UserAvatarBase(props: UserAvatarProps): React.ReactElement {
    const { userId, name, uri, size, borderRadius, accessibilityLabel } = props;
    const theme = useTheme();
    const [failed, setFailed] = useState(false);
    const radius = borderRadius ?? size / 2;

    const recyclingKey = useMemo(() => avatarFileNameOf(uri), [uri]);
    const source = useMemo(() => {
        if (failed || recyclingKey === null) {
            return null;
        }
        return avatarThumbUrl(uri, size, PixelRatio.get());
    }, [failed, recyclingKey, uri, size]);

    if (source === null) {
        const fallbackColor = avatarFallbackColor(
            userId,
            theme.accent,
            theme.colors.background,
        );
        return (
            <View
                accessible={false}
                style={[
                    styles.fallback,
                    {
                        width: size,
                        height: size,
                        borderRadius: radius,
                        backgroundColor: fallbackColor,
                        borderColor: theme.colors.borderStrong,
                    },
                ]}
            >
                <AppText
                    style={[
                        styles.initials,
                        {
                            fontSize: Math.max(
                                10,
                                Math.round(size * 0.38),
                            ),
                            color: readableTextColor(fallbackColor),
                        },
                    ]}
                    numberOfLines={1}
                    allowFontScaling={false}
                >
                    {avatarInitials(name)}
                </AppText>
            </View>
        );
    }

    return (
        <Image
            accessible={false}
            {...(accessibilityLabel !== undefined
                ? { accessibilityLabel }
                : {})}
            source={source}
            style={{ width: size, height: size, borderRadius: radius }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={recyclingKey}
            transition={120}
            onError={(): void => setFailed(true)}
        />
    );
}

export const UserAvatar = memo(UserAvatarBase);

const styles = StyleSheet.create({
    fallback: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    initials: {
        fontWeight: '700',
    },
});
