import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { base } from '$app/paths';
import { languages } from '$lib/languages';
import { TrackPoint, Waypoint, type Coordinates, crossarcDistance, distance, GPXFile } from 'gpx';
import maplibregl from 'maplibre-gl';
import { pointToTile, pointToTileFraction } from '@mapbox/tilebelt';
import type { GPXStatisticsTree } from '$lib/logic/statistics-tree';
import { ListTrackSegmentItem } from '$lib/components/file-list/file-list';
import { getElevationTileUrl } from '$lib/logic/elevation-source';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export function getClosestLinePoint(
    points: TrackPoint[],
    point: TrackPoint | Coordinates,
    details: any = {}
): TrackPoint {
    let closest = points[0];
    let closestDist = Number.MAX_VALUE;
    for (let i = 0; i < points.length - 1; i++) {
        let dist = crossarcDistance(points[i], points[i + 1], point);
        if (dist < closestDist) {
            closestDist = dist;
            if (distance(points[i], point) <= distance(points[i + 1], point)) {
                closest = points[i];
                details['before'] = true;
                details['index'] = i;
            } else {
                closest = points[i + 1];
                details['before'] = false;
                details['index'] = i + 1;
            }
        }
    }
    details['distance'] = closestDist;
    return closest;
}

export function getClosestTrackSegments(
    file: GPXFile,
    statistics: GPXStatisticsTree,
    point: Coordinates
): [number, number][] {
    let segmentBoundsDistances: [number, number, number][] = [];
    file.forEachSegment((segment, trackIndex, segmentIndex) => {
        let segmentStatistics = statistics.getStatisticsFor(
            new ListTrackSegmentItem(file._data.id, trackIndex, segmentIndex)
        );
        let segmentBounds = segmentStatistics.global.bounds;
        let northEast = segmentBounds.northEast;
        let southWest = segmentBounds.southWest;
        let bounds = new maplibregl.LngLatBounds(southWest, northEast);
        if (bounds.contains(point)) {
            segmentBoundsDistances.push([0, trackIndex, segmentIndex]);
        } else {
            let northWest: Coordinates = { lat: northEast.lat, lon: southWest.lon };
            let southEast: Coordinates = { lat: southWest.lat, lon: northEast.lon };
            let distanceToBounds = Math.min(
                crossarcDistance(northWest, northEast, point),
                crossarcDistance(northEast, southEast, point),
                crossarcDistance(southEast, southWest, point),
                crossarcDistance(southWest, northWest, point)
            );
            segmentBoundsDistances.push([distanceToBounds, trackIndex, segmentIndex]);
        }
    });
    segmentBoundsDistances.sort((a, b) => a[0] - b[0]);

    let closest: { distance: number; indices: [number, number][] } = {
        distance: Number.MAX_VALUE,
        indices: [],
    };
    for (let s = 0; s < segmentBoundsDistances.length; s++) {
        if (segmentBoundsDistances[s][0] > closest.distance) {
            break;
        }
        const segment = file.getSegment(segmentBoundsDistances[s][1], segmentBoundsDistances[s][2]);
        segment.trkpt.forEach((pt) => {
            let dist = distance(pt.getCoordinates(), point);
            if (dist < closest.distance) {
                closest.distance = dist;
                closest.indices = [[segmentBoundsDistances[s][1], segmentBoundsDistances[s][2]]];
            } else if (dist === closest.distance) {
                closest.indices.push([segmentBoundsDistances[s][1], segmentBoundsDistances[s][2]]);
            }
        });
    }

    return closest.indices;
}

// Decoded elevation tiles are large (~1MB per 512px tile), so this cache is LRU-bounded,
// mirroring how MapLibre bounds its own tile cache (dynamically ~maxTileCacheZoomLevels x
// viewport tiles) and evicts old, out-of-view tiles. Map iteration is insertion-ordered, so
// the oldest key is evicted first; reads bump recency via `cacheElevationTile`.
const ELEVATION_TILE_CACHE_SIZE = 256;
const elevationTileCache = new Map<string, ImageData | null>();
const elevationTileInflight = new Map<string, Promise<ImageData | null>>();

function cacheElevationTile(key: string, imageData: ImageData | null) {
    // Re-insert so the key becomes the most-recently-used, then evict from the front.
    elevationTileCache.delete(key);
    elevationTileCache.set(key, imageData);
    while (elevationTileCache.size > ELEVATION_TILE_CACHE_SIZE) {
        const oldest = elevationTileCache.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        elevationTileCache.delete(oldest);
    }
}

// Below this map zoom the cursor readout does not load elevation tiles: at low zoom the DEM area
// (especially under globe projection) is too large to load, so the caller shows a "zoom in" hint.
export const MIN_ELEVATION_MAP_ZOOM = 10;

// Canonical DEM zoom for elevation VALUES. Must match `getElevation`'s default so the readout
// reports the same elevation a track point at that location would get, and — crucially — so the
// value does not change as the user zooms the map. Only prefetch tile loading is affected by map
// zoom (via the safety cap below); the sampled value is always taken at this fixed accuracy.
const ELEVATION_DATA_ZOOM = 12;

// Runaway guard for the bulk viewport prefetch. Kept safely BELOW ELEVATION_TILE_CACHE_SIZE so a
// prefetched batch can never exceed the cache and evict its own members mid-pass (that eviction
// thrash caused the same tiles to be refetched ~10x on every moveend/hover). When a z12 viewport
// would exceed this (very low zoom / steep pitch), the bulk prefetch is skipped and hover still
// lazily loads the single z12 tile under the cursor — same value, just not pre-warmed.
const MAX_PREFETCH_TILES_SAFETY = 192;

// Prefetch the z12 DEM tiles covering `bounds` into the shared elevation tile cache, so (1) cursor
// elevation reads resolve instantly and (2) later track creation/routing over the same area reuses
// these tiles instead of re-requesting them. Returns whether elevation is available at all: false
// when `mapZoom` is below `minMapZoom`. Duplicate tiles are deduplicated by `loadElevationTile`.
export function prefetchElevationTiles(
    bounds: maplibregl.LngLatBounds,
    mapZoom: number,
    minMapZoom: number = MIN_ELEVATION_MAP_ZOOM
): boolean {
    if (!Number.isFinite(mapZoom) || mapZoom < minMapZoom) {
        return false;
    }
    const tl = pointToTile(bounds.getWest(), bounds.getNorth(), ELEVATION_DATA_ZOOM);
    const br = pointToTile(bounds.getEast(), bounds.getSouth(), ELEVATION_DATA_ZOOM);
    const xMin = Math.min(tl[0], br[0]);
    const xMax = Math.max(tl[0], br[0]);
    const yMin = Math.min(tl[1], br[1]);
    const yMax = Math.max(tl[1], br[1]);
    const count = (xMax - xMin + 1) * (yMax - yMin + 1);
    // Too many tiles to bulk-prefetch safely (would exceed the cache): keep elevation available and
    // let hover lazily load the single tile under the cursor instead. Never thrash the cache.
    if (!Number.isFinite(count) || count > MAX_PREFETCH_TILES_SAFETY) {
        return true;
    }
    for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
            loadElevationTile(ELEVATION_DATA_ZOOM, x, y);
        }
    }
    return true;
}

function loadElevationTile(zoom: number, x: number, y: number): Promise<ImageData | null> {
    // Key the cache by the resolved URL so switching sources doesn't return stale tiles.
    const url = getElevationTileUrl(zoom, x, y);
    const key = url;

    if (elevationTileCache.has(key)) {
        const cached = elevationTileCache.get(key)!;
        cacheElevationTile(key, cached); // bump LRU recency
        return Promise.resolve(cached);
    }
    const inflight = elevationTileInflight.get(key);
    if (inflight) {
        return inflight;
    }

    const promise = fetch(url, {
        cache: 'force-cache',
    })
        .then((response) => response.blob())
        .then(
            (blob) =>
                new Promise<ImageData | null>((resolve) => {
                    const url = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                        let imageData: ImageData | null = null;
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            imageData = ctx.getImageData(0, 0, img.width, img.height);
                        }
                        URL.revokeObjectURL(url);
                        resolve(imageData);
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve(null);
                    };
                    img.src = url;
                })
        )
        .catch(() => null)
        .then((imageData) => {
            cacheElevationTile(key, imageData);
            elevationTileInflight.delete(key);
            return imageData;
        });

    elevationTileInflight.set(key, promise);
    return promise;
}

export function getElevation(
    points: (TrackPoint | Waypoint | Coordinates)[],
    ELEVATION_ZOOM: number = 12
): Promise<number[]> {
    let coordinates = points.map((point) =>
        point instanceof TrackPoint || point instanceof Waypoint ? point.getCoordinates() : point
    );
    let bbox = new maplibregl.LngLatBounds();
    coordinates.forEach((coord) => bbox.extend(coord));

    let tiles = coordinates.map((coord) => pointToTile(coord.lon, coord.lat, ELEVATION_ZOOM));
    let uniqueTiles = Array.from(new Set(tiles.map((tile) => tile.join(',')))).map((tile) =>
        tile.split(',').map((x) => parseInt(x))
    );
    let images = new Map<string, ImageData>();

    const getPixelFromImageData = (imageData: ImageData, x: number, y: number): number[] => {
        const index = (y * imageData.width + x) * 4;
        return [imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]];
    };

    let promises = uniqueTiles.map((tile) =>
        loadElevationTile(ELEVATION_ZOOM, tile[0], tile[1]).then((imageData) => {
            if (imageData) {
                images.set(tile.join(','), imageData);
            }
        })
    );

    return Promise.all(promises).then(() =>
        coordinates.map((coord, index) => {
            let tile = tiles[index];
            let imageData = images.get(tile.join(','));

            if (!imageData) {
                return 0;
            }

            let tf = pointToTileFraction(coord.lon, coord.lat, ELEVATION_ZOOM);
            // Derive the tile pixel size from the decoded image so sources with
            // different tile sizes (e.g. 256px AWS vs 512px Mapterhorn) both sample correctly.
            let tileWidth = imageData.width;
            let tileHeight = imageData.height;
            let x = tileWidth * (tf[0] - tile[0]);
            let y = tileHeight * (tf[1] - tile[1]);
            let _x = Math.floor(x);
            let _y = Math.floor(y);
            let dx = x - _x;
            let dy = y - _y;

            const p00 = getPixelFromImageData(imageData, _x, _y);
            const p01 = getPixelFromImageData(imageData, _x, _y + (_y + 1 == tileHeight ? 0 : 1));
            const p10 = getPixelFromImageData(imageData, _x + (_x + 1 == tileWidth ? 0 : 1), _y);
            const p11 = getPixelFromImageData(
                imageData,
                _x + (_x + 1 == tileWidth ? 0 : 1),
                _y + (_y + 1 == tileHeight ? 0 : 1)
            );

            let ele00 = -32768 + p00[0] * 256 + p00[1] + p00[2] / 256;
            let ele01 = -32768 + p01[0] * 256 + p01[1] + p01[2] / 256;
            let ele10 = -32768 + p10[0] * 256 + p10[1] + p10[2] / 256;
            let ele11 = -32768 + p11[0] * 256 + p11[1] + p11[2] / 256;

            return (
                ele00 * (1 - dx) * (1 - dy) +
                ele01 * (1 - dx) * dy +
                ele10 * dx * (1 - dy) +
                ele11 * dx * dy
            );
        })
    );
}

export function loadSVGIcon(map: maplibregl.Map, id: string, svg: string, size: number = 100) {
    if (!map.hasImage(id)) {
        let icon = new Image(size, size);
        icon.onload = () => {
            if (!map.hasImage(id)) {
                map.addImage(id, icon);
            }
        };
        icon.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }
}

export function isMac() {
    return navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
}

export function isSafari() {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function getURLForLanguage(lang: string, path: string): string {
    let newPath = path.replace(base, '');

    let languageInPath = newPath.split('/')[1];
    if (!languages.hasOwnProperty(languageInPath)) {
        languageInPath = 'en';
    }

    if (newPath === '/' && lang !== 'en') {
        newPath = '';
    }

    if (languageInPath === 'en') {
        if (lang === 'en') {
            return `${base}${newPath}`;
        } else {
            return `${base}/${lang}${newPath}`;
        }
    } else {
        if (lang === 'en') {
            newPath = newPath.replace(`/${languageInPath}`, '');
            return newPath === '' ? `${base}/` : `${base}${newPath}`;
        } else {
            newPath = newPath.replace(`/${languageInPath}`, `/${lang}`);
            return `${base}${newPath}`;
        }
    }
}
