import { db, type Database } from '$lib/db';
import { liveQuery } from 'dexie';
import type { GPXFile } from 'gpx';
import { applyPatches, produceWithPatches, type Patch, type WritableDraft } from 'immer';
import { GPXFileStateCollectionObserver } from '$lib/logic/file-state';
import { derived, get, type Readable, type Unsubscriber, type Writable } from 'svelte/store';
import { guardSubscribers, safeWritable } from '$lib/logic/safe-store';
import { selection } from '$lib/logic/selection';
import { toast } from 'svelte-sonner';
import { i18n } from '$lib/i18n.svelte';

const MAX_PATCHES = 100;

export class FileActionManager {
    private _db: Database;
    private _files: Map<string, GPXFile>;
    private _fileSubscriptions: Map<string, Unsubscriber>;
    private _fileStateCollectionObserver: GPXFileStateCollectionObserver;
    private _patchIndex: Writable<number>;
    private _patchMinIndex: Writable<number>;
    private _patchMaxIndex: Writable<number>;
    private _canUndo: Readable<boolean>;
    private _canRedo: Readable<boolean>;
    // Every state change (edit, undo, redo) runs as one link in this chain, see _enqueue.
    private _queue: Promise<unknown> = Promise.resolve();
    private _pending = 0;

    constructor(db: Database) {
        this._db = db;
        this._files = new Map();
        this._fileSubscriptions = new Map();
        this._fileStateCollectionObserver = new GPXFileStateCollectionObserver(
            (newFiles) => {
                newFiles.forEach((fileState, fileId) => {
                    this._fileSubscriptions.set(
                        fileId,
                        fileState.subscribe((fileWithStatistics) => {
                            if (fileWithStatistics) {
                                this._files.set(fileId, fileWithStatistics.file);
                            }
                        })
                    );
                });
            },
            (fileId) => {
                const unsubscribe = this._fileSubscriptions.get(fileId);
                if (unsubscribe) {
                    unsubscribe();
                    this._fileSubscriptions.delete(fileId);
                }
                this._files.delete(fileId);
            },
            () => {
                this._fileSubscriptions.forEach((unsubscribe) => unsubscribe());
                this._fileSubscriptions.clear();
                this._files.clear();
            }
        );

        this._patchIndex = safeWritable(-1, 'patchIndex');
        this._patchMinIndex = safeWritable(0, 'patchMinIndex');
        this._patchMaxIndex = safeWritable(0, 'patchMaxIndex');

        liveQuery(() => db.settings.get('patchIndex')).subscribe((value) => {
            if (value !== undefined) {
                this._patchIndex.set(value);
            }
        });
        liveQuery(() =>
            (db.patches.orderBy(':id').keys() as Promise<number[]>).then((keys) => {
                if (keys.length === 0) {
                    return { min: 0, max: 0 };
                } else {
                    return { min: keys[0], max: keys[keys.length - 1] + 1 };
                }
            })
        ).subscribe((value) => {
            this._patchMinIndex.set(value.min);
            this._patchMaxIndex.set(value.max);
        });

        this._canUndo = guardSubscribers(
            derived(
                [this._patchIndex, this._patchMinIndex],
                ([$patchIndex, $patchMinIndex]) => $patchIndex >= $patchMinIndex
            ),
            'canUndo'
        );
        this._canRedo = guardSubscribers(
            derived(
                [this._patchIndex, this._patchMaxIndex],
                ([$patchIndex, $patchMaxIndex]) => $patchIndex < $patchMaxIndex - 1
            ),
            'canRedo'
        );
    }

    get canUndo(): Readable<boolean> {
        return this._canUndo;
    }

    get canRedo(): Readable<boolean> {
        return this._canRedo;
    }

    // Run `op` once every previously started state change has settled. Without this serialization,
    // two operations started within the same IndexedDB round-trip would both build on the same
    // stale `_files` snapshot and claim the same patch index, silently dropping one edit and one
    // undo step. When nothing is in flight the operation still starts synchronously, so callers
    // that reset state right after the call keep seeing their producer run immediately.
    private _enqueue<T>(op: () => Promise<T>): Promise<T> {
        const result = this._pending === 0 ? op() : this._queue.then(op);
        this._pending++;
        this._queue = result
            .catch(() => {}) // a failed operation must not poison the chain
            .finally(() => {
                this._pending--;
            });
        return result;
    }

    undo(): Promise<boolean> {
        return this._enqueue(async () => {
            const patchIndex = await this._readPatchIndex();
            if (patchIndex < get(this._patchMinIndex)) {
                return false;
            }
            const patch = await this._db.patches.get(patchIndex);
            if (!patch || !(await this._applyPatch(patch.inversePatch))) {
                return false;
            }
            await this._setPatchIndex(patchIndex - 1);
            return true;
        });
    }

    redo(): Promise<boolean> {
        return this._enqueue(async () => {
            const patchIndex = (await this._readPatchIndex()) + 1;
            if (patchIndex >= get(this._patchMaxIndex)) {
                return false;
            }
            const patch = await this._db.patches.get(patchIndex);
            if (!patch || !(await this._applyPatch(patch.patch))) {
                return false;
            }
            await this._setPatchIndex(patchIndex);
            return true;
        });
    }

    // Apply a patch from the edit history. Resolves to whether it could be applied: a stored patch
    // can reference a path that no longer resolves against the current state, and that must not
    // leave the history cursor pointing at an entry that was never applied.
    private async _applyPatch(patch: Patch[]): Promise<boolean> {
        let newFiles: Map<string, GPXFile>;
        try {
            // Never pass the live `_files` to immer: it freezes the base when the patch changes
            // nothing, and a frozen Map throws on every later write.
            newFiles = applyPatches(new Map(this._files), patch);
        } catch (error) {
            console.error('Could not apply patch from the edit history:', error);
            toast.error(i18n._('menu.history_error'));
            return false;
        }
        await this._commit(newFiles, patch);
        return true;
    }

    // The `_patchIndex` store is only a mirror for the UI: it is fed by a liveQuery, so it can still
    // hold the previous value right after a write. Anything that moves the cursor reads it back from
    // the database instead, which is authoritative.
    private async _readPatchIndex(): Promise<number> {
        const stored = await this._db.settings.get('patchIndex');
        return stored ?? -1;
    }

    // Update the mirror immediately so undo/redo buttons react without waiting for the liveQuery.
    private async _setPatchIndex(index: number) {
        this._patchIndex.set(index);
        await this._db.settings.put(index, 'patchIndex');
    }

    private _commit(newFiles: ReadonlyMap<string, GPXFile>, patch: Patch[]) {
        // Make the new state the base for the next operation right away. `_files` is otherwise only
        // refreshed once the write has round-tripped through the database and been rehydrated.
        this._files = new Map(newFiles);

        const changedFileIds = getChangedFileIds(patch);
        let updatedFileIds: string[] = [];
        const deletedFileIds: string[] = [];

        changedFileIds.forEach((id) => {
            if (newFiles.has(id)) {
                updatedFileIds.push(id);
            } else {
                deletedFileIds.push(id);
            }
        });

        const updatedFiles = updatedFileIds
            .map((id) => newFiles.get(id))
            .filter((file) => file !== undefined) as GPXFile[];
        updatedFileIds = updatedFiles.map((file) => file._data.id);

        selection.updateFiles(updatedFiles, deletedFileIds);

        // @ts-expect-error Dexie transaction overload does not accept the variadic tables + async scope signature
        return this._db.transaction('rw', this._db.fileids, this._db.files, async () => {
            if (updatedFileIds.length > 0) {
                await this._db.fileids.bulkPut(updatedFileIds, updatedFileIds);
                await this._db.files.bulkPut(updatedFiles, updatedFileIds);
            }
            if (deletedFileIds.length > 0) {
                await this._db.fileids.bulkDelete(deletedFileIds);
                await this._db.files.bulkDelete(deletedFileIds);
            }
        });
    }

    applyGlobal(callback: (files: Map<string, GPXFile>) => void) {
        return this._applyWithPatches(callback);
    }

    applyToFiles(fileIds: string[], callback: (file: WritableDraft<GPXFile>) => void) {
        return this._applyWithPatches((draft) => {
            fileIds.forEach((fileId) => {
                const file = draft.get(fileId);
                if (file) {
                    callback(file);
                }
            });
        });
    }

    applyToFile(fileId: string, callback: (file: WritableDraft<GPXFile>) => void) {
        return this.applyToFiles([fileId], callback);
    }

    applyEachToFilesAndGlobal(
        fileIds: string[],
        callbacks: ((file: WritableDraft<GPXFile>, context?: any) => void)[],
        globalCallback: (files: Map<string, GPXFile>, context?: any) => void,
        context?: any
    ) {
        return this._applyWithPatches((draft) => {
            fileIds.forEach((fileId, index) => {
                const file = draft.get(fileId);
                if (file) {
                    callbacks[index](file, context);
                }
            });
            globalCallback(draft, context);
        });
    }

    // Shared implementation for every mutation: run the callback inside immer's producer, persist the
    // patches, and commit the new state to the database. All mutation paths flow through here so that
    // an exception thrown by any operation (e.g. timestamp math on a malformed track) cannot escape
    // into the caller — it is logged and re-thrown so button handlers can show user feedback without
    // the error aborting a reactive store update or leaving the app half-mutated.
    // Resolves to whether anything actually changed: a producer that leaves the state untouched yields
    // an empty patch, which we skip entirely (no phantom undo entry, no no-op commit) and report as
    // `false` so callers can surface an accurate "nothing changed" message.
    private _applyWithPatches(
        producer: (draft: Map<string, WritableDraft<GPXFile>>) => void
    ): Promise<boolean> {
        return this._enqueue(async () => {
            try {
                // The base must be a throwaway copy: when the producer changes nothing, immer
                // deep-freezes the base it was given, and a frozen `_files` Map throws on every
                // later write — which used to take the whole app down with it.
                const [newFileCollection, patch, inversePatch] = produceWithPatches(
                    new Map(this._files),
                    producer
                );

                if (patch.length === 0) {
                    return false;
                }

                await this.storePatches(patch, inversePatch);

                await this._commit(newFileCollection, patch);
                return true;
            } catch (error) {
                console.error('File mutation failed:', error);
                throw error;
            }
        });
    }

    // Persist the patch pair for undo/redo. The cursor is read and moved inside a single transaction:
    // two mutations that both read it before either had written would store their patch under the
    // same key and lose one undo step together with the inverse patch needed to get back.
    private async storePatches(patch: Patch[], inversePatch: Patch[]) {
        const trim =
            get(this._patchMaxIndex) - get(this._patchMinIndex) + 1 > MAX_PATCHES
                ? get(this._patchMaxIndex) - MAX_PATCHES
                : undefined;
        const index = await this._db.transaction(
            'rw',
            this._db.patches,
            this._db.settings,
            async () => {
                const current = (await this._db.settings.get('patchIndex')) ?? -1;
                await this._db.patches.where(':id').above(current).delete(); // Delete all patches after the current patch to avoid redoing them
                if (trim !== undefined) {
                    await this._db.patches.where(':id').belowOrEqual(trim).delete();
                }
                const next = current + 1;
                await this._db.patches.put(
                    {
                        patch,
                        inversePatch,
                        index: next,
                    },
                    next
                );
                await this._db.settings.put(next, 'patchIndex');
                return next;
            }
        );
        this._patchIndex.set(index);
    }
}

// Get the file ids of the files that have changed in the patch
function getChangedFileIds(patch: Patch[]): string[] {
    const changedFileIds = new Set<string>();
    for (const p of patch) {
        changedFileIds.add(p.path[0] as string);
    }
    return Array.from(changedFileIds);
}

export const fileActionManager = new FileActionManager(db);
