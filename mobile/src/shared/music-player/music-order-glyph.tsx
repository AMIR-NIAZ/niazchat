import { ArrowLeft, ArrowRight, Shuffle } from 'lucide-react-native';
import type { MusicPlayOrder } from './music-queue';

/** Short label shown in the selector / toast for each play order. */
export const MUSIC_ORDER_LABELS: Record<MusicPlayOrder, string> = {
    forward: 'Playing in order',
    backward: 'Playing in reverse',
    shuffle: 'Shuffle',
};

/** Long description used by screen readers. */
export const MUSIC_ORDER_DESCRIPTIONS: Record<MusicPlayOrder, string> = {
    forward: 'Forward, first to last',
    backward: 'Backward, last to first',
    shuffle: 'Shuffle',
};

/** Icon of one play order, from the app's existing lucide set. */
export function MusicOrderGlyph({
    order,
    size,
    color,
}: {
    order: MusicPlayOrder;
    size: number;
    color: string;
}): React.ReactElement {
    if (order === 'backward') {
        return <ArrowLeft size={size} color={color} strokeWidth={2.2} />;
    }
    if (order === 'shuffle') {
        return <Shuffle size={size} color={color} strokeWidth={2.2} />;
    }
    return <ArrowRight size={size} color={color} strokeWidth={2.2} />;
}
