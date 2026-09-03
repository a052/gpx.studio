import { type Database } from '$lib/db';
import { liveQuery } from 'dexie';
import {
    basemaps,
    defaultBasemap,
    defaultBasemapTree,
    defaultOpacities,
    defaultOverlays,
    defaultOverlayTree,
    defaultOverpassQueries,
    defaultOverpassTree,
    defaultTerrainSource,
    overpassTree,
    type CustomLayer,
    type LayerTreeType,
} from '$lib/assets/layers';
import { browser } from '$app/environment';
import { get, type Writable } from 'svelte/store';
import { safeWritable } from '$lib/logic/safe-store';

export class Setting<V> {
    private _db: Database | null = null;
    private _subscription: { unsubscribe: () => void } | null = null;
    private _key: string;
    private _value: Writable<V>;
    private _validator?: (value: V) => V;

    constructor(key: string, initial: V, validator?: (value: V) => V) {
        this._key = key;
        this._value = safeWritable(initial, `setting ${key}`);
        this._validator = validator;
    }

    connectToDatabase(db: Database) {
        if (this._db) return;
        this._db = db;

        let first = true;
        this._subscription = liveQuery(() => db.settings.get(this._key)).subscribe((value) => {
            if (value === undefined) {
                if (!first) {
                    this._value.set(value as V);
                }
            } else {
                if (this._validator) {
                    value = this._validator(value as V);
                }
                this._value.set(value as V);
            }
            first = false;
        });
    }

    disconnectFromDatabase() {
        this._subscription?.unsubscribe();
        this._subscription = null;
        this._db = null;
    }

    subscribe(run: (value: V) => void, invalidate?: (value?: V) => void) {
        return this._value.subscribe(run, invalidate);
    }

    set(value: V) {
        if (typeof value === 'object' || value !== get(this._value)) {
            this._value.set(value);
            if (this._db) {
                this._db.settings.put(value, this._key);
            }
        }
    }

    update(callback: (value: V) => V) {
        this.set(callback(get(this._value)));
    }
}

export class SettingInitOnFirstRead<V> {
    private _db: Database | null = null;
    private _subscription: { unsubscribe: () => void } | null = null;
    private _key: string;
    private _value: Writable<V | undefined>;
    private _initial: V;
    private _validator?: (value: V) => V;

    constructor(key: string, initial: V, validator?: (value: V) => V) {
        this._key = key;
        this._value = safeWritable(undefined, `setting ${key}`);
        this._initial = initial;
        this._validator = validator;
    }

    connectToDatabase(db: Database) {
        if (this._db) return;
        this._db = db;

        let first = true;
        this._subscription = liveQuery(() => db.settings.get(this._key)).subscribe((value) => {
            if (value === undefined) {
                if (first) {
                    this._value.set(this._initial);
                } else {
                    this._value.set(value);
                }
            } else {
                if (this._validator) {
                    value = this._validator(value as V);
                }
                this._value.set(value as V);
            }
            first = false;
        });
    }

    initialize() {
        this.set(this._initial);
    }

    disconnectFromDatabase() {
        this._subscription?.unsubscribe();
        this._subscription = null;
        this._db = null;
    }

    subscribe(run: (value: V | undefined) => void, invalidate?: (value?: V | undefined) => void) {
        return this._value.subscribe(run, invalidate);
    }

    set(value: V) {
        if (typeof value === 'object' || value !== get(this._value)) {
            if (this._db) {
                this._db.settings.put(value, this._key);
            } else {
                this._value.set(value);
            }
        }
    }

    // The parameter is `V | undefined` because that is honestly what the store holds before the
    // first read. Callers that cannot cope with undefined should use updateWhenLoaded instead.
    update(callback: (value: V | undefined) => V) {
        this.set(callback(get(this._value)));
    }

    // Like update(), but for callers that must not run before the stored value has arrived: the
    // callback gets a defined value, immediately if one is already loaded and otherwise on the
    // first defined emission. Writing earlier than that cannot work — before connectToDatabase
    // the write lands in _value and is then overwritten by the liveQuery's first emission, and
    // after it the write races that same initial read.
    updateWhenLoaded(callback: (value: V) => V) {
        const value = get(this._value);
        if (value !== undefined) {
            this.set(callback(value));
            return;
        }
        // subscribe() runs its callback synchronously with the current value, which we just
        // established is undefined, so that first invocation returns at the guard below and
        // `unsubscribe` is never read before it is initialised.
        //
        // `done` is what guarantees the callback runs at most once, and it is not redundant with
        // the unsubscribe: set() below re-enters svelte/store's shared notification flush, which
        // re-notifies the subscriptions still registered at that point. Without the flag, queueing
        // three callbacks before the first emission runs them 6 times in total.
        let done = false;
        const unsubscribe = this.subscribe((pending) => {
            if (done || pending === undefined) {
                return;
            }
            done = true;
            unsubscribe();
            this.set(callback(pending));
        });
    }
}

function getValueValidator<V>(allowed: V[], fallback: V) {
    const dict = new Set<V>(allowed);
    return (value: V) => (dict.has(value) ? value : fallback);
}

function getNumberValidator(min: number, max: number, fallback: number) {
    return (value: number) => {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, value));
    };
}

function getArrayValidator<V>(allowed: V[]) {
    const dict = new Set<V>(allowed);
    return (value: V[]) => value.filter((v) => dict.has(v));
}

function getLayerValidator(allowed: Record<string, unknown>, fallback: string) {
    return (layer: string) =>
        Object.hasOwn(allowed, layer) ||
        layer.startsWith('custom-') ||
        layer.startsWith('extension-')
            ? layer
            : fallback;
}

function filterLayerTree(t: LayerTreeType, allowed: LayerTreeType | undefined): LayerTreeType {
    const filtered: LayerTreeType = {};
    if (allowed) {
        Object.entries(allowed).forEach(([key, value]) => {
            if (Object.hasOwn(t, key)) {
                if (typeof value === 'boolean') {
                    filtered[key] = t[key];
                } else if (typeof value === 'object') {
                    filtered[key] = filterLayerTree(
                        typeof t[key] === 'object' ? t[key] : {},
                        value
                    );
                }
            } else {
                filtered[key] = value;
            }
        });
    }
    Object.entries(t).forEach(([key, value]) => {
        if (!Object.hasOwn(filtered, key)) {
            if (typeof value === 'boolean') {
                if (key.startsWith('custom-') || key.startsWith('extension-')) {
                    filtered[key] = value;
                }
            } else if (typeof value === 'object') {
                filtered[key] = filterLayerTree(value, undefined);
            }
        }
    });
    return filtered;
}

function getLayerTreeValidator(allowed: LayerTreeType) {
    return (value: LayerTreeType) => filterLayerTree(value, allowed);
}

type DistanceUnits = 'metric' | 'imperial' | 'nautical';
type VelocityUnits = 'speed' | 'pace';
type TemperatureUnits = 'celsius' | 'fahrenheit';
// Exported so the embedding options, which build this list from their own boolean flags, are checked
// against the same ids the elevation profile looks for.
export type AdditionalDataset = 'speed' | 'hr' | 'cad' | 'atemp' | 'power';
type ElevationFill = 'slope' | 'surface' | 'highway' | undefined;
type ElevationProfileXAxis = 'distance' | 'time';
type RoutingProfile =
    | 'bike'
    | 'racing_bike'
    | 'gravel_bike'
    | 'mountain_bike'
    | 'foot'
    | 'motorcycle'
    | 'water'
    | 'railway';
type RoutingProvider = 'default' | 'official' | 'custom' | 'brouter';
type OverpassProvider = 'default' | 'custom';
type ElevationSource = 'mapterhorn' | 'aws' | 'custom';
type TerrainSource = 'mapterhorn';
type Projection = 'globe' | 'mercator';
type StreetViewSource = 'mapillary' | 'google';

export const settings = {
    distanceUnits: new Setting<DistanceUnits>(
        'distanceUnits',
        'metric',
        getValueValidator<DistanceUnits>(['metric', 'imperial', 'nautical'], 'metric')
    ),
    velocityUnits: new Setting<VelocityUnits>(
        'velocityUnits',
        'speed',
        getValueValidator<VelocityUnits>(['speed', 'pace'], 'speed')
    ),
    temperatureUnits: new Setting<TemperatureUnits>(
        'temperatureUnits',
        'celsius',
        getValueValidator<TemperatureUnits>(['celsius', 'fahrenheit'], 'celsius')
    ),
    elevationProfile: new Setting<boolean>('elevationProfile', false),
    elevationGainThreshold: new Setting<number>(
        'elevationGainThreshold',
        3,
        getNumberValidator(0, 20, 3)
    ),
    elevationSmoothingWindow: new Setting<number>(
        'elevationSmoothingWindow',
        20,
        getNumberValidator(0, 200, 20)
    ),
    additionalDatasets: new Setting<AdditionalDataset[]>(
        'additionalDatasets',
        [],
        getArrayValidator<AdditionalDataset>(['speed', 'hr', 'cad', 'atemp', 'power'])
    ),
    elevationFill: new Setting<ElevationFill>(
        'elevationFill',
        undefined,
        getValueValidator(['slope', 'surface', 'highway', undefined], undefined)
    ),
    elevationProfileXAxis: new Setting<ElevationProfileXAxis>(
        'elevationProfileXAxis',
        'distance',
        getValueValidator<ElevationProfileXAxis>(['distance', 'time'], 'distance')
    ),
    treeFileView: new Setting<boolean>('fileView', false),
    minimizeRoutingMenu: new Setting('minimizeRoutingMenu', false),
    routing: new Setting('routing', true),
    routingProfile: new Setting<RoutingProfile>(
        'routingProfile',
        'bike',
        getValueValidator<RoutingProfile>(
            [
                'bike',
                'racing_bike',
                'gravel_bike',
                'mountain_bike',
                'foot',
                'motorcycle',
                'water',
                'railway',
            ],
            'bike'
        )
    ),
    privateRoads: new Setting('privateRoads', false),
    routingProvider: new Setting<RoutingProvider>(
        'routingProvider',
        'default',
        getValueValidator<RoutingProvider>(['default', 'official', 'custom', 'brouter'], 'default')
    ),
    graphhopperApiKey: new Setting<string>('graphhopperApiKey', ''),
    graphhopperCustomUrl: new Setting<string>('graphhopperCustomUrl', ''),
    overpassProvider: new Setting<OverpassProvider>(
        'overpassProvider',
        'default',
        getValueValidator<OverpassProvider>(['default', 'custom'], 'default')
    ),
    overpassCustomUrl: new Setting<string>('overpassCustomUrl', ''),
    elevationSource: new Setting<ElevationSource>(
        'elevationSource',
        'mapterhorn',
        getValueValidator<ElevationSource>(['mapterhorn', 'aws', 'custom'], 'mapterhorn')
    ),
    elevationSourceCustomUrl: new Setting<string>('elevationSourceCustomUrl', ''),
    corsProxyUrl: new Setting<string>('corsProxyUrl', ''),
    currentBasemap: new Setting(
        'currentBasemap',
        defaultBasemap,
        getLayerValidator(basemaps, defaultBasemap)
    ),
    previousBasemap: new Setting(
        'previousBasemap',
        defaultBasemap,
        getLayerValidator(basemaps, defaultBasemap)
    ),
    selectedBasemapTree: new Setting(
        'selectedBasemapTree',
        defaultBasemapTree,
        getLayerTreeValidator(defaultBasemapTree)
    ),
    currentOverlays: new SettingInitOnFirstRead(
        'currentOverlays',
        defaultOverlays,
        getLayerTreeValidator(defaultOverlayTree)
    ),
    previousOverlays: new Setting(
        'previousOverlays',
        defaultOverlays,
        getLayerTreeValidator(defaultOverlayTree)
    ),
    selectedOverlayTree: new Setting(
        'selectedOverlayTree',
        defaultOverlayTree,
        getLayerTreeValidator(defaultOverlayTree)
    ),
    currentOverpassQueries: new SettingInitOnFirstRead(
        'currentOverpassQueries',
        defaultOverpassQueries,
        getLayerTreeValidator(overpassTree)
    ),
    selectedOverpassTree: new Setting(
        'selectedOverpassTree',
        defaultOverpassTree,
        getLayerTreeValidator(overpassTree)
    ),
    opacities: new Setting('opacities', defaultOpacities),
    customLayers: new Setting<Record<string, CustomLayer>>('customLayers', {}),
    customBasemapOrder: new Setting<string[]>('customBasemapOrder', []),
    customOverlayOrder: new Setting<string[]>('customOverlayOrder', []),
    terrainSource: new Setting<TerrainSource>(
        'terrainSource',
        defaultTerrainSource,
        getValueValidator(['mapterhorn'], defaultTerrainSource)
    ),
    // Map projection, toggled by the MapLibre GlobeControl. Persisted so the choice survives a style
    // rebuild (basemap switch) — the control itself only calls map.setProjection().
    projection: new Setting<Projection>(
        'projection',
        'mercator',
        getValueValidator<Projection>(['globe', 'mercator'], 'mercator')
    ),
    directionMarkers: new Setting('directionMarkers', false),
    distanceMarkers: new Setting('distanceMarkers', false),
    threeD: new Setting<boolean>('threeD', false),
    coordinateReadout: new Setting<boolean>('coordinateReadout', false),
    showWaypoints: new Setting<boolean>('showWaypoints', false),
    streetViewSource: new Setting<StreetViewSource>(
        'streetViewSource',
        'mapillary',
        getValueValidator<StreetViewSource>(['mapillary', 'google'], 'mapillary')
    ),
    fileOrder: new Setting<string[]>('fileOrder', []),
    defaultOpacity: new Setting('defaultOpacity', 0.7),
    defaultWidth: new Setting('defaultWidth', browser && window.innerWidth < 600 ? 8 : 5),
    bottomPanelSize: new Setting('bottomPanelSize', 170),
    rightPanelSize: new Setting('rightPanelSize', 240),
    connectToDatabase(db: Database) {
        for (const key in settings) {
            const setting = (settings as Record<string, unknown>)[key];
            if (setting instanceof Setting || setting instanceof SettingInitOnFirstRead) {
                setting.connectToDatabase(db);
            }
        }
    },
    disconnectFromDatabase() {
        for (const key in settings) {
            const setting = (settings as Record<string, unknown>)[key];
            if (setting instanceof Setting || setting instanceof SettingInitOnFirstRead) {
                setting.disconnectFromDatabase();
            }
        }
    },
    initialize() {
        for (const key in settings) {
            const setting = (settings as Record<string, unknown>)[key];
            if (setting instanceof SettingInitOnFirstRead) {
                setting.initialize();
            }
        }
    },
};
