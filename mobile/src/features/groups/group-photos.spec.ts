import {
    MAX_GROUP_AVATARS,
    groupHasPhotoGallery,
    groupPhotoActions,
    groupPhotoLimitHint,
    groupPhotoTileVisibility,
} from './group-model';

describe('group photo helpers', () => {
    it('shows the gallery only when there is more than the header photo', () => {
        expect(groupHasPhotoGallery(0)).toBe(false);
        expect(groupHasPhotoGallery(1)).toBe(false);
        expect(groupHasPhotoGallery(2)).toBe(true);
        expect(groupHasPhotoGallery(MAX_GROUP_AVATARS)).toBe(true);
    });

    it('replaces the add tile with the limit hint at ten photos', () => {
        expect(groupPhotoTileVisibility(0)).toEqual({
            showAdd: true,
            showLimit: false,
        });
        expect(groupPhotoTileVisibility(9)).toEqual({
            showAdd: true,
            showLimit: false,
        });
        expect(groupPhotoTileVisibility(10)).toEqual({
            showAdd: false,
            showLimit: true,
        });
    });

    it('derives viewer actions from canEditInfo only', () => {
        expect(groupPhotoActions(true)).toEqual({
            canAdd: true,
            canSetMain: true,
            canDelete: true,
            viewerReadOnly: false,
        });
        expect(groupPhotoActions(false)).toEqual({
            canAdd: false,
            canSetMain: false,
            canDelete: false,
            viewerReadOnly: true,
        });
    });

    it('shows the limit hint only at ten photos', () => {
        expect(groupPhotoLimitHint(0)).toBeNull();
        expect(groupPhotoLimitHint(9)).toBeNull();
        expect(groupPhotoLimitHint(10)).toContain('10/10');
    });
});
