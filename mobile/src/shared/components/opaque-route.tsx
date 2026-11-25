import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { ThemeScope, useTheme } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';

/**
 * Opaque routes.
 *
 * Routes listed here are painted on a plain theme canvas instead of the global
 * app background: the screen's scene background is opaque (set in the layout)
 * and every glass/translucent surface resolves to a fully opaque theme color,
 * so nothing looks washed out on a background that is no longer behind it.
 *
 * The route list lives in ONE place. Screens opt in through the layout, never
 * through per-screen style overrides.
 */

/** Prefixes (pathnames, without the `(app)` group) rendered opaque. */
const OPAQUE_ROUTE_PREFIXES = [
    // The other user's public profile.
    '/user/',
    // Group profile (group info).
    '/group/',
    // Group profile sub-screens: settings, members, invite links, bans…
    '/group-settings/',
] as const;

function isOpaquePathname(pathname: string): boolean {
    const path = pathname.split('?')[0] ?? pathname;
    return OPAQUE_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const OpaqueRouteContext = createContext(false);

/** `true` inside a route (and its sub-screens) that covers the app background. */
export function useOpaqueRoute(): boolean {
    return useContext(OpaqueRouteContext);
}

/**
 * The same theme with every translucent glass fill swapped for its opaque
 * counterpart. Typography, accent and every other token stay untouched, so
 * `useThemedStyles` sheets (and the cached rows that share them) just rebuild
 * once for the opaque variant.
 */
function opaqueTheme(theme: AppTheme): AppTheme {
    return {
        ...theme,
        colors: {
            ...theme.colors,
            glassSurface: theme.colors.surface,
            glassElevated: theme.colors.surfaceElevated,
            glassHeader: theme.colors.backgroundAlt,
        },
    };
}

/**
 * Publishes the current route's opaqueness and, while it is opaque, re-provides
 * the theme subtree-wide. Mount once inside `ThemeProvider` (root layout).
 */
export function OpaqueRouteProvider({
    children,
}: {
    children: ReactNode;
}): React.ReactElement {
    const pathname = usePathname();
    const theme = useTheme();
    const opaque = isOpaquePathname(pathname);
    const scopedTheme = useMemo(
        (): AppTheme => (opaque ? opaqueTheme(theme) : theme),
        [opaque, theme],
    );

    return (
        <OpaqueRouteContext.Provider value={opaque}>
            <ThemeScope theme={scopedTheme}>{children}</ThemeScope>
        </OpaqueRouteContext.Provider>
    );
}
