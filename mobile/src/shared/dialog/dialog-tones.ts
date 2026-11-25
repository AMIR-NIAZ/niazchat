import { Check, Info, Trash2, TriangleAlert } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { withAlpha } from '../theme/colors';
import type { AppTheme } from '../theme/theme-provider';
import type { DialogTone } from './dialog-types';

/**
 * One badge per tone: icon, icon colour and the translucent wash behind it.
 * `default`/`info` use the active accent so a plain notice still looks
 * on-brand; `danger` is the theme's red used by destructive confirmations.
 * Resolved from the theme at render time, so the badges follow light/dark and
 * the accent setting.
 */

export interface ToneStyle {
    icon: LucideIcon;
    color: string;
    wash: string;
}

export function toneStyle(tone: DialogTone, theme: AppTheme): ToneStyle {
    switch (tone) {
        case 'info':
            return {
                icon: Info,
                color: theme.colors.info,
                wash: withAlpha(theme.colors.info, 0.16),
            };
        case 'success':
            return {
                icon: Check,
                color: theme.colors.success,
                wash: withAlpha(theme.colors.success, 0.16),
            };
        case 'warning':
            return {
                icon: TriangleAlert,
                color: theme.colors.warning,
                wash: withAlpha(theme.colors.warning, 0.16),
            };
        case 'danger':
            return {
                icon: Trash2,
                color: theme.colors.danger,
                wash: withAlpha(theme.colors.danger, 0.16),
            };
        default:
            return {
                icon: Info,
                color: theme.accent,
                wash: theme.colors.accentSoft,
            };
    }
}
