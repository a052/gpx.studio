import { type Writable } from 'svelte/store';
import { safeWritable } from '$lib/logic/safe-store';
import { SelectedGPXFilesObserver, selection } from '$lib/logic/selection';
import { fileStateCollection } from '$lib/logic/file-state';

// File-level info for the "Show all information" panel. Unlike the statistics store, this is scoped
// to the whole file(s) the selection touches (not the selected sub-tracks/segments) and is
// independent of chart range-slicing — it describes the file itself.
export type FileInfo = {
    trackCount: number;
    segmentCount: number;
    pointCount: number;
    waypointCount: number;
    // The creator/device string, only when all selected files share a single one; undefined when
    // there is none or they differ (no meaningful single value across files).
    creator: string | undefined;
    // Median interval (seconds) between consecutive in-segment points; undefined when no time data.
    samplingRate: number | undefined;
};

function emptyFileInfo(): FileInfo {
    return {
        trackCount: 0,
        segmentCount: 0,
        pointCount: 0,
        waypointCount: 0,
        creator: undefined,
        samplingRate: undefined,
    };
}

export class SelectedFileInfo {
    private _value: Writable<FileInfo>;

    constructor() {
        this._value = safeWritable(emptyFileInfo(), 'selectedFileInfo');
        new SelectedGPXFilesObserver(() => this.update());
    }

    subscribe(run: (value: FileInfo) => void, invalidate?: (value?: FileInfo) => void) {
        return this._value.subscribe(run, invalidate);
    }

    update() {
        const info = emptyFileInfo();
        const creators = new Set<string>();
        const intervals: number[] = [];

        // One callback per file in the selection (items are grouped by file), so each file is
        // counted exactly once regardless of how many sub-items are selected.
        selection.applyToSelectedItemsFromFile((fileId) => {
            const file = fileStateCollection.getFile(fileId);
            if (!file) {
                return;
            }
            info.trackCount += file.trk.length;
            info.waypointCount += file.wpt.length;
            const segments = file.getSegments();
            info.segmentCount += segments.length;
            info.pointCount += file.getNumberOfTrackPoints();
            if (file.attributes.creator) {
                creators.add(file.attributes.creator);
            }
            segments.forEach((segment) => {
                const points = segment.trkpt;
                for (let i = 1; i < points.length; i++) {
                    const previous = points[i - 1].time;
                    const current = points[i].time;
                    if (previous && current) {
                        const delta = (current.getTime() - previous.getTime()) / 1000;
                        if (delta > 0) {
                            intervals.push(delta);
                        }
                    }
                }
            });
        });

        info.creator = creators.size === 1 ? [...creators][0] : undefined;

        if (intervals.length > 0) {
            intervals.sort((a, b) => a - b);
            const mid = Math.floor(intervals.length / 2);
            info.samplingRate =
                intervals.length % 2 === 0
                    ? (intervals[mid - 1] + intervals[mid]) / 2
                    : intervals[mid];
        }

        this._value.set(info);
    }
}

export const fileInfo = new SelectedFileInfo();
