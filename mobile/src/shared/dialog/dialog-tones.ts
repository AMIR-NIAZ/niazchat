import { Check, Info, Trash2, TriangleAlert } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { palette } from '../theme';
import type { DialogTone } from './dialog-types';

/**
 * One badge per tone: icon, icon colour and the translucent wash behind it.
 * `default`/`info` share the purple accent so a plain notice still looks
 * on-brand; `danger` is the red used by destructive confirmations.
 */

export interface ToneStyle {
    icon: LucideIcon;
    color: string;
    wash: string;
}

export const TONE_STYLES: Record<DialogTone, ToneStyle> = {
    default: {
        icon: Info,
        color: palette.primary[600],
        wash: 'rgba(169,112,245,0.16)',
    },
    info: {
        icon: Info,
        color: palette.semantic.info,
        wash: 'rgba(155,199,255,0.16)',
    },
    success: {
        icon: Check,
        color: palette.semantic.success,
        wash: 'rgba(111,215,155,0.16)',
    },
    warning: {
        icon: TriangleAlert,
        color: palette.semantic.warning,
        wash: 'rgba(245,197,107,0.16)',
    },
    danger: {
        icon: Trash2,
        color: palette.semantic.danger,
        wash: 'rgba(255,122,138,0.16)',
    },
};
