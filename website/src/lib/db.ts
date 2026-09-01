import Dexie from 'dexie';
import type { GPXFile } from 'gpx';
import { enableMapSet, enablePatches, setAutoFreeze, type Patch } from 'immer';

enableMapSet();
enablePatches();
// The app deliberately keeps long-lived mutable state next to immer: FileActionManager._files and
// the rehydrated GPXFile trees the UI holds. immer's auto-freeze deep-freezes that live state — a
// producer that changes nothing freezes the base Map itself — which turned an ordinary edit into a
// permanent app-wide freeze (a frozen Map throws on .set(), the throw escaped through a Svelte store
// flush, and svelte/store's shared subscriber queue then stopped delivering to every store).
// Nothing in the codebase relies on frozen state, and the freeze walk costs O(all trackpoints) on
// every edit. The explicit freeze() calls used as immer perf hints are unaffected by this flag.
setAutoFreeze(false);

export class Database extends Dexie {
    fileids!: Dexie.Table<string, string>;
    files!: Dexie.Table<GPXFile, string>;
    patches!: Dexie.Table<{ patch: Patch[]; inversePatch: Patch[]; index: number }, number>;
    settings!: Dexie.Table<unknown, string>;
    overpasstiles!: Dexie.Table<
        { query: string; x: number; y: number; time: number },
        [string, number, number]
    >;
    overpassdata!: Dexie.Table<
        { query: string; id: number; poi: GeoJSON.Feature },
        [string, number]
    >;

    constructor() {
        super('Database', {
            cache: 'immutable',
        });
        this.version(1).stores({
            fileids: ',&fileid',
            files: '',
            patches: ',patch',
            settings: '',
            overpasstiles: '[query+x+y],[x+y]',
            overpassdata: '[query+id]',
        });
    }
}

export const db = new Database();
