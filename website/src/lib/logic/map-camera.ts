import type * as maplibregl from 'maplibre-gl';
import { db } from '$lib/db';
import { map, MAX_PITCH, type MapCamera } from '$lib/components/map/map';

const CAMERA_KEY = 'mapCamera';

// Rounded the way MapLibre rounds its own URL hash: precise enough to land back on the same view,
// coarse enough that panning away and back does not produce a new value to store every time.
function readCamera(map_: maplibregl.Map): MapCamera {
    const center = map_.getCenter();
    return {
        lng: Math.round(center.lng * 1e6) / 1e6,
        lat: Math.round(center.lat * 1e6) / 1e6,
        zoom: Math.round(map_.getZoom() * 100) / 100,
        bearing: Math.round(map_.getBearing() * 10) / 10,
        pitch: Math.round(map_.getPitch() * 10) / 10,
    };
}

function sameCamera(a: MapCamera, b: MapCamera): boolean {
    return (
        a.lng === b.lng &&
        a.lat === b.lat &&
        a.zoom === b.zoom &&
        a.bearing === b.bearing &&
        a.pitch === b.pitch
    );
}

function inRange(value: unknown, min: number, max: number): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// The settings table is plain user-writable storage and a stored camera outlives the code that wrote
// it, so validate before handing anything to the Map constructor: a NaN or an out-of-range value
// would open the app on a blank canvas with no way back other than clearing the database.
function isMapCamera(value: unknown): value is MapCamera {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const camera = value as Record<string, unknown>;
    return (
        inRange(camera.lng, -180, 180) &&
        inRange(camera.lat, -90, 90) &&
        inRange(camera.zoom, 0, 22) &&
        inRange(camera.bearing, -180, 180) &&
        inRange(camera.pitch, 0, MAX_PITCH)
    );
}

// Remembers the map viewport across visits to /app, so re-entering the app shows where the user
// left off instead of the hardcoded default or the bounds of whatever files the database restores.
//
// This is deliberately not a `Setting`: nothing subscribes to the camera, and a Setting hands out
// its initial value until the database has loaded — worthless here, because the map is constructed
// from this value once, before that first emission can arrive (see the note on updateWhenLoaded in
// logic/settings.ts). Owning the key directly is the same approach as the patch index in
// logic/file-action-manager.ts.
class MapCameraPersistence {
    private _read: Promise<MapCamera | undefined> | null = null;
    private _restored = false;
    private _unsubscribe: (() => void) | null = null;
    private _hooked: maplibregl.Map | null = null;
    private _last: MapCamera | null = null;

    private _save = () => {
        const map_ = this._hooked;
        if (!map_) {
            return;
        }
        const camera = readCamera(map_);
        // moveend also fires for resize(), which is wired to six stores, and for every programmatic
        // fit, so most events carry a camera that is already stored.
        if (this._last !== null && sameCamera(this._last, camera)) {
            return;
        }
        this._last = camera;
        db.settings.put(camera, CAMERA_KEY).catch((error) => {
            console.error('Failed to store the map camera:', error);
        });
    };

    // Read the camera saved by the previous visit and start recording the current one. Called from
    // Map.svelte before map.init, whose caller awaits the result to pass it to the Map constructor.
    enable(): Promise<MapCamera | undefined> {
        this.disable();
        const read = db.settings
            .get(CAMERA_KEY)
            .catch((error) => {
                // A blocked or broken database must not keep the map from being created.
                console.error('Failed to read the stored map camera:', error);
                return undefined;
            })
            .then((value) => {
                const camera = isMapCamera(value) ? value : undefined;
                // A disable() while the read was in flight (navigating away from /app) supersedes it.
                if (this._read === read) {
                    this._restored = camera !== undefined;
                    this._last = camera ?? null;
                }
                return camera;
            });
        this._read = read;
        // The map store holds null until the map has loaded, and null again once it is destroyed, so
        // this picks up whichever map comes next. map.onLoad is not usable here: it hands out the
        // previous, already-removed map when coming back to /app through an in-app navigation.
        this._unsubscribe = map.subscribe((map_) => {
            if (!map_ || map_ === this._hooked) {
                return;
            }
            this._hooked = map_;
            map_.on('moveend', this._save);
            // Store the viewport the map opened with, so a visit without any interaction still
            // leaves something to come back to.
            this._save();
        });
        return read;
    }

    // Resolves once the stored camera has been read, so callers whose behaviour depends on whether
    // one was restored (BoundsManager) do not race that read. Resolves immediately when the camera
    // is not being restored at all, as in an embed.
    ready(): Promise<void> {
        return this._read ? this._read.then(() => undefined) : Promise.resolve();
    }

    // Whether a stored camera was handed to the Map constructor on this visit.
    get restored(): boolean {
        return this._restored;
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._hooked?.off('moveend', this._save);
        this._hooked = null;
        this._read = null;
        this._restored = false;
        this._last = null;
    }
}

export const mapCamera = new MapCameraPersistence();
