import { updateAnchorPoints } from '$lib/components/toolbar/tools/routing/simplify';
import { type Database } from '$lib/db';
import { liveQuery } from 'dexie';
import { GPXFile, setElevationOptions } from 'gpx';
import { GPXStatisticsTree, type GPXFileWithStatistics } from '$lib/logic/statistics-tree';
import { safeWritable } from '$lib/logic/safe-store';
import { settings } from '$lib/logic/settings';
import { get, type Subscriber, type Writable } from 'svelte/store';

// Observe a single file from the database, and maintain its statistics
export class GPXFileState {
    private _fileId: string;
    private _file: Writable<GPXFileWithStatistics | undefined>;
    private _subscription: { unsubscribe: () => void } | undefined;

    constructor(fileId: string, file?: GPXFile) {
        this._fileId = fileId;
        this._file = safeWritable(
            file ? { file, statistics: new GPXStatisticsTree(file) } : undefined,
            `file ${fileId}`
        );
    }

    connectToDatabase(db: Database) {
        if (this._subscription) return;
        this._subscription = liveQuery(() => db.files.get(this._fileId)).subscribe((value) => {
            if (value === undefined) {
                return;
            }
            let rehydrated: GPXFileWithStatistics;
            try {
                const file = new GPXFile(value);
                updateAnchorPoints(file);
                rehydrated = { file, statistics: new GPXStatisticsTree(file) };
            } catch (error) {
                // Rehydration/statistics computation can fail on malformed data. Swallowing the error
                // here prevents a single broken file from aborting the reactive update chain and
                // freezing the whole UI. The stored file is left as-is for the next liveQuery event.
                console.error(`Failed to rehydrate file ${this._fileId}:`, error);
                return;
            }
            // Outside the try on purpose: an error raised by a subscriber of this store is not a
            // rehydration failure, and it reports itself through the store's own guard.
            this._file.set(rehydrated);
        });
    }

    subscribe(run: Subscriber<GPXFileWithStatistics | undefined>, invalidate?: () => void) {
        return this._file.subscribe(run, invalidate);
    }

    // Rebuild the statistics tree from the current in-memory file without re-reading the database.
    // Used when a setting that only affects computed statistics (e.g. elevation gain/loss options)
    // changes, since those do not modify the stored file and therefore do not trigger the liveQuery.
    recomputeStatistics() {
        const current = get(this._file);
        if (current === undefined) {
            return;
        }
        let statistics: GPXStatisticsTree;
        try {
            statistics = new GPXStatisticsTree(current.file);
        } catch (error) {
            // Keep the previous statistics rather than breaking the reactive graph.
            console.error(`Failed to recompute statistics for file ${this._fileId}:`, error);
            return;
        }
        this._file.set({ file: current.file, statistics });
    }

    destroy() {
        this._subscription?.unsubscribe();
        this._subscription = undefined;
    }

    get file(): GPXFile | undefined {
        return get(this._file)?.file;
    }

    get statistics(): GPXStatisticsTree | undefined {
        return get(this._file)?.statistics;
    }
}

// Observe the file ids in the database, and maintain a map of file states for the corresponding files
export class GPXFileStateCollection {
    private _files: Writable<Map<string, GPXFileState>>;
    private _subscription: { unsubscribe: () => void } | null = null;

    constructor() {
        this._files = safeWritable(new Map(), 'fileStateCollection');
    }

    connectToDatabase(db: Database): Promise<void> {
        return new Promise((resolve) => {
            if (this._subscription) {
                resolve();
                return;
            }
            this._subscription = liveQuery(() => db.fileids.toArray()).subscribe((dbFileIds) => {
                const currentFiles = get(this._files);
                // Find new files to observe
                const newFiles = dbFileIds
                    .filter((id) => !currentFiles.has(id))
                    .sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]));
                // Find deleted files to stop observing
                const deletedFiles = Array.from(currentFiles.keys()).filter(
                    (id) => !dbFileIds.find((fileId) => fileId === id)
                );

                if (newFiles.length > 0 || deletedFiles.length > 0) {
                    // Update the map of file states
                    this._files.update(($files) => {
                        newFiles.forEach((id) => {
                            const fileState = new GPXFileState(id);
                            fileState.connectToDatabase(db);
                            $files.set(id, fileState);
                        });
                        deletedFiles.forEach((id) => {
                            $files.get(id)?.destroy();
                            $files.delete(id);
                        });
                        return $files;
                    });

                    // Update the file order
                    const fileOrder = get(settings.fileOrder).filter(
                        (id) => !deletedFiles.includes(id)
                    );
                    newFiles.forEach((id) => {
                        if (!fileOrder.includes(id)) {
                            fileOrder.push(id);
                        }
                    });
                    settings.fileOrder.set(fileOrder);
                }
                resolve();
            });
        });
    }

    disconnectFromDatabase() {
        this._subscription?.unsubscribe();
        this._subscription = null;
        this._files.update(($files) => {
            $files.forEach((fileState) => {
                fileState.destroy();
            });
            return new Map();
        });
    }

    setEmbeddedFiles(files: GPXFile[]) {
        this._files.update(($files) => {
            $files.clear();
            files.forEach((file) => {
                const id = file._data.id;
                if (!$files.has(id)) {
                    const fileState = new GPXFileState(id, file);
                    $files.set(id, fileState);
                }
            });
            return $files;
        });
    }

    subscribe(run: Subscriber<Map<string, GPXFileState>>, invalidate?: () => void) {
        return this._files.subscribe(run, invalidate);
    }

    get size(): number {
        return get(this._files).size;
    }

    getFileState(fileId: string): GPXFileState | undefined {
        return get(this._files).get(fileId);
    }

    getFile(fileId: string): GPXFile | undefined {
        const fileState = get(this._files).get(fileId);
        return fileState?.file;
    }

    getStatistics(fileId: string): GPXStatisticsTree | undefined {
        const fileState = get(this._files).get(fileId);
        return fileState?.statistics;
    }

    forEach(callback: (fileId: string, file: GPXFile) => void) {
        get(this._files).forEach((fileState, fileId) => {
            if (fileState.file) {
                callback(fileId, fileState.file);
            }
        });
    }

    recomputeAllStatistics() {
        get(this._files).forEach((fileState) => {
            fileState.recomputeStatistics();
        });
    }
}

// Collection of all file states
export const fileStateCollection = new GPXFileStateCollection();

// Recompute statistics for all open files whenever an elevation option changes. These settings only
// affect the derived statistics (gain/loss), not the stored file, so the database liveQuery would not
// otherwise pick them up. `skip` avoids an initial redundant recompute on subscription.
let elevationOptionsInitialized = false;
function onElevationOptionChange() {
    try {
        setElevationOptions({
            gainThresholdMeters: get(settings.elevationGainThreshold),
            smoothingWindowMeters: get(settings.elevationSmoothingWindow),
        });
        if (elevationOptionsInitialized) {
            fileStateCollection.recomputeAllStatistics();
        }
    } catch (error) {
        // This runs inside a settings-store subscriber. An uncaught throw here would propagate out of
        // the store's .set() and corrupt the shared reactive graph, freezing the UI until refresh.
        console.error('Failed to apply elevation option change:', error);
    }
}
settings.elevationGainThreshold.subscribe(onElevationOptionChange);
settings.elevationSmoothingWindow.subscribe(onElevationOptionChange);
elevationOptionsInitialized = true;

export type GPXFileStateCallback = (files: Map<string, GPXFileState>) => void;
export class GPXFileStateCollectionObserver {
    private _fileIds: Set<string>;
    private _onFilesAdded: GPXFileStateCallback;
    private _onFileRemoved: (fileId: string) => void;
    private _onDestroy: () => void;
    private _unsubscribe: () => void;

    constructor(
        onFilesAdded: GPXFileStateCallback,
        onFileRemoved: (fileId: string) => void,
        onDestroy: () => void
    ) {
        this._fileIds = new Set();
        this._onFilesAdded = onFilesAdded;
        this._onFileRemoved = onFileRemoved;
        this._onDestroy = onDestroy;

        this._unsubscribe = fileStateCollection.subscribe((files) => {
            this._fileIds.forEach((fileId) => {
                if (!files.has(fileId)) {
                    this._onFileRemoved(fileId);
                    this._fileIds.delete(fileId);
                }
            });
            const newFiles = new Map<string, GPXFileState>();
            files.forEach((file: GPXFileState, fileId: string) => {
                if (!this._fileIds.has(fileId)) {
                    newFiles.set(fileId, file);
                    this._fileIds.add(fileId);
                }
            });
            if (newFiles.size > 0) {
                this._onFilesAdded(newFiles);
            }
        });
    }

    destroy() {
        this._onDestroy();
        this._unsubscribe();
    }
}
