import {
    ListFileItem,
    ListItem,
    ListRootItem,
    ListTrackItem,
    ListTrackSegmentItem,
    ListWaypointItem,
    ListLevel,
    sortItems,
    ListWaypointsItem,
} from '$lib/components/file-list/file-list';
import { fileStateCollection, GPXFileStateCollectionObserver } from '$lib/logic/file-state';
import { settings } from '$lib/logic/settings';
import type { GPXFile } from 'gpx';
import { get, type Readable, type Writable } from 'svelte/store';
import { safeWritable } from '$lib/logic/safe-store';
import { SelectionTreeType } from '$lib/logic/selection-tree';

export class Selection {
    private _selection: Writable<SelectionTreeType>;
    private _copied: Writable<ListItem[] | undefined>;
    private _cut: Writable<boolean>;

    constructor() {
        this._selection = safeWritable(new SelectionTreeType(new ListRootItem()), 'selection');
        this._copied = safeWritable(undefined, 'copiedSelection');
        this._cut = safeWritable(false, 'cutSelection');
    }

    subscribe(
        run: (value: SelectionTreeType) => void,
        invalidate?: (value?: SelectionTreeType) => void
    ) {
        return this._selection.subscribe(run, invalidate);
    }

    update(updater: (value: SelectionTreeType) => SelectionTreeType) {
        this._selection.update(updater);
    }

    selectItem(item: ListItem) {
        this._selection.update(($selection) => {
            $selection.clear();
            $selection.set(item, true);
            return $selection;
        });
    }

    selectFile(fileId: string) {
        this.selectItem(new ListFileItem(fileId));
    }

    addSelectItem(item: ListItem) {
        this._selection.update(($selection) => {
            $selection.toggle(item);
            return $selection;
        });
    }

    addSelectFile(fileId: string) {
        this.addSelectItem(new ListFileItem(fileId));
    }

    selectAll() {
        let item: ListItem = new ListRootItem();
        get(this._selection).forEach((i) => {
            item = i;
        });
        this._selection.update(($selection) => {
            $selection.clear();
            if (item instanceof ListRootItem || item instanceof ListFileItem) {
                fileStateCollection.forEach((fileId) => {
                    $selection.set(new ListFileItem(fileId), true);
                });
            } else if (item instanceof ListTrackItem) {
                const file = fileStateCollection.getFile(item.getFileId());
                if (file) {
                    file.trk.forEach((_track, trackId) => {
                        $selection.set(new ListTrackItem(item.getFileId(), trackId), true);
                    });
                }
            } else if (item instanceof ListTrackSegmentItem) {
                const file = fileStateCollection.getFile(item.getFileId());
                if (file) {
                    file.trk[item.getTrackIndex()].trkseg.forEach((_segment, segmentId) => {
                        $selection.set(
                            new ListTrackSegmentItem(
                                item.getFileId(),
                                item.getTrackIndex(),
                                segmentId
                            ),
                            true
                        );
                    });
                }
            } else if (item instanceof ListWaypointItem) {
                const file = fileStateCollection.getFile(item.getFileId());
                if (file) {
                    file.wpt.forEach((_waypoint, waypointId) => {
                        $selection.set(new ListWaypointItem(item.getFileId(), waypointId), true);
                    });
                }
            }
            return $selection;
        });
    }

    deselectAll() {
        this._selection.update(($selection) => {
            $selection.clear();
            return $selection;
        });
    }

    selectFileWhenLoaded(fileId: string) {
        const unsubscribe = fileStateCollection.subscribe((files) => {
            if (files.has(fileId)) {
                this.selectFile(fileId);
                unsubscribe();
            }
        });
    }

    set(items: ListItem[]) {
        this._selection.update(($selection) => {
            $selection.clear();
            items.forEach((item) => {
                $selection.set(item, true);
            });
            return $selection;
        });
    }

    updateFiles(updatedFiles: GPXFile[], deletedFileIds: string[]) {
        const removedItems: ListItem[] = [];
        applyToOrderedItemsFromFile(get(this._selection).getSelected(), (fileId, level, items) => {
            const file = updatedFiles.find((file) => file._data.id === fileId);
            if (file) {
                items.forEach((item) => {
                    if (item instanceof ListTrackItem) {
                        const newTrackIndex = file.trk.findIndex(
                            (track) => track._data.trackIndex === item.getTrackIndex()
                        );
                        if (newTrackIndex === -1) {
                            removedItems.push(item);
                        }
                    } else if (item instanceof ListTrackSegmentItem) {
                        const newTrackIndex = file.trk.findIndex(
                            (track) => track._data.trackIndex === item.getTrackIndex()
                        );
                        if (newTrackIndex === -1) {
                            removedItems.push(item);
                        } else {
                            const newSegmentIndex = file.trk[newTrackIndex].trkseg.findIndex(
                                (segment) => segment._data.segmentIndex === item.getSegmentIndex()
                            );
                            if (newSegmentIndex === -1) {
                                removedItems.push(item);
                            }
                        }
                    } else if (item instanceof ListWaypointItem) {
                        const newWaypointIndex = file.wpt.findIndex(
                            (wpt) => wpt._data.index === item.getWaypointIndex()
                        );
                        if (newWaypointIndex === -1) {
                            removedItems.push(item);
                        }
                    }
                });
            } else if (deletedFileIds.includes(fileId)) {
                items.forEach((item) => {
                    removedItems.push(item);
                });
            }
        });
        if (removedItems.length > 0) {
            this._selection.update(($selection) => {
                removedItems.forEach((item) => {
                    if (item instanceof ListFileItem) {
                        $selection.deleteChild(item.getFileId());
                    } else {
                        $selection.set(item, false);
                    }
                });
                return $selection;
            });
        }
    }

    updateFromKey(down: boolean, shift: boolean) {
        const selected = get(this._selection).getSelected();
        if (selected.length === 0) {
            return;
        }

        let next: ListItem | undefined = undefined;
        if (selected[0] instanceof ListFileItem) {
            const order = get(settings.fileOrder);
            let limitIndex: number | undefined = undefined;
            selected.forEach((item) => {
                const index = order.indexOf(item.getFileId());
                if (
                    limitIndex === undefined ||
                    (down && index > limitIndex) ||
                    (!down && index < limitIndex)
                ) {
                    limitIndex = index;
                }
            });

            if (limitIndex !== undefined) {
                let nextIndex = down ? limitIndex + 1 : limitIndex - 1;

                while (true) {
                    if (nextIndex < 0) {
                        nextIndex = order.length - 1;
                    } else if (nextIndex >= order.length) {
                        nextIndex = 0;
                    }

                    if (nextIndex === limitIndex) {
                        break;
                    }

                    next = new ListFileItem(order[nextIndex]);
                    if (!get(selection).has(next)) {
                        break;
                    }

                    nextIndex += down ? 1 : -1;
                }
            }
        } else if (
            selected[0] instanceof ListTrackItem &&
            selected[selected.length - 1] instanceof ListTrackItem
        ) {
            const fileId = selected[0].getFileId();
            const file = fileStateCollection.getFile(fileId);
            if (file) {
                const numberOfTracks = file.trk.length;
                const trackIndex = down
                    ? selected[selected.length - 1].getTrackIndex()
                    : selected[0].getTrackIndex();
                if (down && trackIndex < numberOfTracks - 1) {
                    next = new ListTrackItem(fileId, trackIndex + 1);
                } else if (!down && trackIndex > 0) {
                    next = new ListTrackItem(fileId, trackIndex - 1);
                }
            }
        } else if (
            selected[0] instanceof ListTrackSegmentItem &&
            selected[selected.length - 1] instanceof ListTrackSegmentItem
        ) {
            const fileId = selected[0].getFileId();
            const file = fileStateCollection.getFile(fileId);
            if (file) {
                const trackIndex = selected[0].getTrackIndex();
                const numberOfSegments = file.trk[trackIndex].trkseg.length;
                const segmentIndex = down
                    ? selected[selected.length - 1].getSegmentIndex()
                    : selected[0].getSegmentIndex();
                if (down && segmentIndex < numberOfSegments - 1) {
                    next = new ListTrackSegmentItem(fileId, trackIndex, segmentIndex + 1);
                } else if (!down && segmentIndex > 0) {
                    next = new ListTrackSegmentItem(fileId, trackIndex, segmentIndex - 1);
                }
            }
        } else if (
            selected[0] instanceof ListWaypointItem &&
            selected[selected.length - 1] instanceof ListWaypointItem
        ) {
            const fileId = selected[0].getFileId();
            const file = fileStateCollection.getFile(fileId);
            if (file) {
                const numberOfWaypoints = file.wpt.length;
                const waypointIndex = down
                    ? selected[selected.length - 1].getWaypointIndex()
                    : selected[0].getWaypointIndex();
                if (down && waypointIndex < numberOfWaypoints - 1) {
                    next = new ListWaypointItem(fileId, waypointIndex + 1);
                } else if (!down && waypointIndex > 0) {
                    next = new ListWaypointItem(fileId, waypointIndex - 1);
                }
            }
        }

        if (next && (!get(this._selection).has(next) || !shift)) {
            if (shift) {
                this.addSelectItem(next);
            } else {
                this.selectItem(next);
            }
        }
    }

    getOrderedSelection(reverse: boolean = false): ListItem[] {
        const selected: ListItem[] = [];
        this.applyToOrderedSelectedItemsFromFile((fileId, level, items) => {
            selected.push(...items);
        }, reverse);
        return selected;
    }

    applyToSelectedItemsFromFile(
        callback: (fileId: string, level: ListLevel | undefined, items: ListItem[]) => void
    ) {
        const selectedItems = get(this._selection).getSelected();
        get(fileStateCollection).forEach((_, fileId) => {
            let level: ListLevel | undefined = undefined;
            const items: ListItem[] = [];
            selectedItems.forEach((item) => {
                if (item.getFileId() === fileId) {
                    level = item.level;
                    if (
                        item instanceof ListFileItem ||
                        item instanceof ListTrackItem ||
                        item instanceof ListTrackSegmentItem ||
                        item instanceof ListWaypointsItem ||
                        item instanceof ListWaypointItem
                    ) {
                        items.push(item);
                    }
                }
            });
            if (items.length > 0) {
                callback(fileId, level, items);
            }
        });
    }

    applyToOrderedSelectedItemsFromFile(
        callback: (fileId: string, level: ListLevel | undefined, items: ListItem[]) => void,
        reverse: boolean = true
    ) {
        applyToOrderedItemsFromFile(get(this._selection).getSelected(), callback, reverse);
    }

    copySelection(): boolean {
        const selected = get(this._selection).getSelected();
        if (selected.length > 0) {
            this._copied.set(selected);
            this._cut.set(false);
            return true;
        }
        return false;
    }

    cutSelection() {
        if (this.copySelection()) {
            this._cut.set(true);
        }
    }

    resetCopied() {
        this._copied.set(undefined);
        this._cut.set(false);
    }

    get copied(): Readable<ListItem[] | undefined> {
        return this._copied;
    }

    get cut(): Readable<boolean> {
        return this._cut;
    }
}

export const selection = new Selection();
export const copied = selection.copied;
export const cut = selection.cut;

export function applyToOrderedItemsFromFile(
    selectedItems: ListItem[],
    callback: (fileId: string, level: ListLevel | undefined, items: ListItem[]) => void,
    reverse: boolean = true
) {
    get(settings.fileOrder).forEach((fileId) => {
        let level: ListLevel | undefined = undefined;
        const items: ListItem[] = [];
        selectedItems.forEach((item) => {
            if (item.getFileId() === fileId) {
                level = item.level;
                if (
                    item instanceof ListFileItem ||
                    item instanceof ListTrackItem ||
                    item instanceof ListTrackSegmentItem ||
                    item instanceof ListWaypointsItem ||
                    item instanceof ListWaypointItem
                ) {
                    items.push(item);
                }
            }
        });

        if (items.length > 0) {
            sortItems(items, reverse);
            callback(fileId, level, items);
        }
    });
}

export class SelectedGPXFilesObserver {
    private _fileStateCollectionObserver: GPXFileStateCollectionObserver;
    private _unsubscribes: Map<string, () => void> = new Map();

    constructor(onSelectedFileChange: () => void) {
        this._unsubscribes = new Map();
        this._fileStateCollectionObserver = new GPXFileStateCollectionObserver(
            (newFiles) => {
                newFiles.forEach((fileState, fileId) => {
                    this._unsubscribes.set(
                        fileId,
                        fileState.subscribe(() => {
                            if (get(selection).hasAnyChildren(new ListFileItem(fileId))) {
                                onSelectedFileChange();
                            }
                        })
                    );
                });
            },
            (fileId) => {
                this._unsubscribes.get(fileId)?.();
                this._unsubscribes.delete(fileId);
            },
            () => {
                this._unsubscribes.forEach((unsubscribe) => unsubscribe());
                this._unsubscribes.clear();
            }
        );
        selection.subscribe(() => onSelectedFileChange());
    }
}
