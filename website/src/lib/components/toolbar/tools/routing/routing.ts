import type { Coordinates } from 'gpx';
import { TrackPoint, distance } from 'gpx';
import { settings } from '$lib/logic/settings';
import { getElevation } from '$lib/utils';
import { get } from 'svelte/store';

const {
    routing,
    routingProfile,
    privateRoads,
    routingProvider,
    graphhopperApiKey,
    graphhopperCustomUrl,
} = settings;

const DEFAULT_GRAPHHOPPER_URL = 'https://graphhopper.gpx.studio/route';
const OFFICIAL_GRAPHHOPPER_URL = 'https://graphhopper.com/api/1/route';

export type RoutingProfile = {
    graphhopper?: string;
    osrm?: 'bike' | 'foot' | 'car';
    brouter: string;
};

// One profile name per engine. Which engine is actually used depends on the selected provider
// (see resolveRouting): water/railway always route through BRouter, otherwise the provider decides.
export const routingProfiles: { [key: string]: RoutingProfile } = {
    bike: { graphhopper: 'bike', osrm: 'bike', brouter: 'fastbike' },
    racing_bike: { graphhopper: 'racingbike', osrm: 'bike', brouter: 'fastbike' },
    gravel_bike: { graphhopper: 'gravelbike', osrm: 'bike', brouter: 'trekking' },
    mountain_bike: { graphhopper: 'mtb', osrm: 'bike', brouter: 'trekking' },
    foot: { graphhopper: 'foot', osrm: 'foot', brouter: 'hiking-mountain' },
    motorcycle: { graphhopper: 'motorbike', osrm: 'car', brouter: 'moped' },
    water: { brouter: 'river' },
    railway: { brouter: 'rail' },
};

function resolveRouting(
    activity: string,
    provider: string
): { engine: 'graphhopper' | 'osrm' | 'brouter'; profile: string } {
    const def = routingProfiles[activity];
    // Water and railway have no GraphHopper/OSRM equivalent, so they always use BRouter, as does
    // the dedicated BRouter provider for every activity.
    if (activity === 'water' || activity === 'railway' || provider === 'brouter') {
        return { engine: 'brouter', profile: def.brouter };
    }
    if (provider === 'default') {
        return { engine: 'osrm', profile: def.osrm ?? 'foot' };
    }
    // 'official' | 'custom' → GraphHopper (graphhopper.com or a self-hosted server).
    return { engine: 'graphhopper', profile: def.graphhopper ?? 'foot' };
}

export function route(points: Coordinates[]): Promise<TrackPoint[]> {
    if (get(routing)) {
        const { engine, profile } = resolveRouting(get(routingProfile), get(routingProvider));
        if (engine === 'graphhopper') {
            return getGraphHopperRoute(points, profile, get(privateRoads)).then(
                withMapterhornElevation
            );
        } else if (engine === 'osrm') {
            return getOSRMRoute(points, profile as 'bike' | 'foot' | 'car').then(
                withMapterhornElevation
            );
        } else {
            return getBRouterRoute(points, profile).then(withMapterhornElevation);
        }
    } else {
        return getIntermediatePoints(points);
    }
}

// Resample every point's elevation from the Mapterhorn DEM so that draw-time elevation matches the
// terrain shown on the map and the "Request elevation data" action, regardless of the routing engine.
// Without this, GraphHopper/BRouter routes carry the routing provider's own DEM, which disagrees with
// Mapterhorn and yields different elevation gain/loss.
function withMapterhornElevation(route: TrackPoint[]): Promise<TrackPoint[]> {
    return getElevation(route).then((elevations) => {
        route.forEach((point, i) => {
            point.ele = elevations[i];
        });
        return route;
    });
}

const graphhopperDetails = ['road_class', 'surface', 'hike_rating', 'mtb_rating'];
const hikeRatingToSACScale: { [key: string]: string } = {
    '1': 'hiking',
    '2': 'mountain_hiking',
    '3': 'demanding_mountain_hiking',
    '4': 'alpine_hiking',
    '5': 'demanding_alpine_hiking',
    '6': 'difficult_alpine_hiking',
};
const mtbRatingToScale: { [key: string]: string } = {
    '1': '0',
    '2': '1',
    '3': '2',
    '4': '3',
    '5': '4',
    '6': '5',
    '7': '6',
};

const graphhopperBlockPrivateCustomModels: Record<string, unknown> = {
    bike: {
        priority: [
            {
                if: 'bike_road_access == PRIVATE',
                multiply_by: '0.0',
            },
        ],
    },
    racingbike: {
        priority: [
            {
                if: 'bike_road_access == PRIVATE',
                multiply_by: '0.0',
            },
        ],
    },
    gravelbike: {
        priority: [
            {
                if: 'bike_road_access == PRIVATE',
                multiply_by: '0.0',
            },
        ],
    },
    mtb: {
        priority: [
            {
                if: 'bike_road_access == PRIVATE',
                multiply_by: '0.0',
            },
        ],
    },
    foot: {
        priority: [
            {
                if: 'foot_road_access == PRIVATE',
                multiply_by: '0.0',
            },
        ],
    },
    motorcycle: {
        priority: [
            {
                if: 'road_access == PRIVATE',
                multiply_by: '0.0',
            },
        ],
    },
};
async function getGraphHopperRoute(
    points: Coordinates[],
    graphHopperProfile: string,
    privateRoads: boolean
): Promise<TrackPoint[]> {
    const provider = get(routingProvider);
    const official = provider === 'official';

    let url: string;
    if (provider === 'official') {
        url = `${OFFICIAL_GRAPHHOPPER_URL}?key=${encodeURIComponent(get(graphhopperApiKey))}`;
    } else if (provider === 'custom') {
        url = get(graphhopperCustomUrl).trim() || DEFAULT_GRAPHHOPPER_URL;
    } else {
        url = DEFAULT_GRAPHHOPPER_URL;
    }

    const customModel = privateRoads
        ? {}
        : graphhopperBlockPrivateCustomModels[graphHopperProfile] || {};
    const hasCustomModel = Object.keys(customModel).length > 0;

    // hike_rating / mtb_rating are only exposed by the self-hosted config; the
    // official server would reject them, so request only the common details there.
    const requestedDetails = official ? ['road_class', 'surface'] : graphhopperDetails;

    const body: Record<string, unknown> = {
        points: points.map((point) => [point.lon, point.lat]),
        profile: graphHopperProfile,
        elevation: true,
        points_encoded: false,
        details: requestedDetails,
    };
    if (official) {
        // On the official API, sending any custom_model (even an empty one)
        // requires ch.disable=true. When private roads are allowed we send no
        // custom_model at all so the free plan's speed mode handles the request.
        if (hasCustomModel) {
            body.custom_model = customModel;
            body['ch.disable'] = true;
        }
    } else {
        body.custom_model = customModel;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message: string = error?.message ?? '';
        const hintDetails: string = error?.hints?.[0]?.details ?? '';

        if (message.includes('Cannot find point 0')) {
            throw new Error('toolbar.routing.error.from');
        } else if (message.includes('Cannot find point 1')) {
            if (points.length == 3) {
                throw new Error('toolbar.routing.error.via');
            } else {
                throw new Error('toolbar.routing.error.to');
            }
        } else if (hintDetails.includes('PointDistanceExceededException')) {
            throw new Error('toolbar.routing.error.distance');
        } else if (hintDetails.includes('ConnectionNotFoundException')) {
            throw new Error('toolbar.routing.error.connection');
        } else if (official && (response.status === 401 || /api key|unauthorized/i.test(message))) {
            throw new Error('toolbar.routing.error.api_key');
        } else if (official && (response.status === 429 || /limit|quota/i.test(message))) {
            throw new Error('toolbar.routing.error.quota');
        } else if (official && /profile/i.test(message)) {
            throw new Error('toolbar.routing.error.profile');
        } else if (official && /custom_model|ch\.disable|encoded value|details/i.test(message)) {
            throw new Error('toolbar.routing.error.unsupported_feature');
        } else {
            throw new Error(message || 'toolbar.routing.error.connection');
        }
    }

    const json = await response.json();

    const route: TrackPoint[] = [];
    const coordinates = json.paths[0].points.coordinates;
    const details = json.paths[0].details;

    for (let i = 0; i < coordinates.length; i++) {
        route.push(
            new TrackPoint({
                attributes: {
                    lat: coordinates[i][1],
                    lon: coordinates[i][0],
                },
                ele: coordinates[i][2] ?? (i > 0 ? route[i - 1].ele : 0),
                extensions: {},
            })
        );
    }

    for (const key of requestedDetails) {
        const detail = details[key];
        for (let i = 0; i < detail.length; i++) {
            for (let j = detail[i][0]; j < detail[i][1] + (i == detail.length - 1); j++) {
                if (detail[i][2] !== undefined && detail[i][2] !== 'missing') {
                    if (key === 'road_class') {
                        route[j].setExtension('highway', detail[i][2]);
                    } else if (key === 'hike_rating') {
                        const sacScale = hikeRatingToSACScale[detail[i][2]];
                        if (sacScale) {
                            route[j].setExtension('sac_scale', sacScale);
                        }
                    } else if (key === 'mtb_rating') {
                        const mtbScale = mtbRatingToScale[detail[i][2]];
                        if (mtbScale) {
                            route[j].setExtension('mtb_scale', mtbScale);
                        }
                    } else if (key === 'surface' && detail[i][2] !== 'other') {
                        route[j].setExtension('surface', detail[i][2]);
                    }
                }
            }
        }
    }

    return route;
}

const OSRM_BASE_URL = 'https://routing.openstreetmap.de';

async function getOSRMRoute(
    points: Coordinates[],
    osrmProfile: 'bike' | 'foot' | 'car'
): Promise<TrackPoint[]> {
    // routing.openstreetmap.de hosts one OSRM instance per profile (routed-bike/foot/car); the
    // mode segment in the path is always "driving" regardless of the instance.
    const coords = points
        .map((point) => `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`)
        .join(';');
    const url = `${OSRM_BASE_URL}/routed-${osrmProfile}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const json = await response.json().catch(() => ({}));

    if (!response.ok || json.code !== 'Ok') {
        if (json?.code === 'NoSegment') {
            throw new Error('toolbar.routing.error.from');
        } else if (json?.code === 'NoRoute') {
            throw new Error('toolbar.routing.error.connection');
        } else {
            throw new Error(json?.message || 'toolbar.routing.error.connection');
        }
    }

    // OSRM geometry is 2D (no elevation) and carries no way tags; withMapterhornElevation adds ele.
    const route: TrackPoint[] = [];
    const coordinates = json.routes[0].geometry.coordinates;
    for (let i = 0; i < coordinates.length; i++) {
        route.push(
            new TrackPoint({
                attributes: {
                    lat: coordinates[i][1],
                    lon: coordinates[i][0],
                },
            })
        );
    }

    return route;
}

async function getBRouterRoute(
    points: Coordinates[],
    brouterProfile: string
): Promise<TrackPoint[]> {
    const url = `https://brouter.de/brouter?lonlats=${points.map((point) => `${point.lon.toFixed(8)},${point.lat.toFixed(8)}`).join('|')}&profile=${brouterProfile}&format=geojson&alternativeidx=0`;

    const response = await fetch(url);

    if (!response.ok) {
        const error = await response.text();
        if (error.includes('from-position not mapped in existing datafile')) {
            throw new Error('toolbar.routing.error.from');
        } else if (error.includes('via1-position not mapped in existing datafile')) {
            throw new Error('toolbar.routing.error.via');
        } else if (error.includes('to-position not mapped in existing datafile')) {
            throw new Error('toolbar.routing.error.to');
        } else if (error.includes('Time-out')) {
            throw new Error('toolbar.routing.error.timeout');
        } else {
            throw new Error(error);
        }
    }

    const geojson = await response.json();

    const route: TrackPoint[] = [];
    const coordinates = geojson.features[0].geometry.coordinates;
    const messages = geojson.features[0].properties.messages;

    const lngIdx = messages[0].indexOf('Longitude');
    const latIdx = messages[0].indexOf('Latitude');
    const tagIdx = messages[0].indexOf('WayTags');
    let messageIdx = 1;
    let tags = messageIdx < messages.length ? getTags(messages[messageIdx][tagIdx]) : {};

    for (let i = 0; i < coordinates.length; i++) {
        route.push(
            new TrackPoint({
                attributes: {
                    lat: coordinates[i][1],
                    lon: coordinates[i][0],
                },
                ele: coordinates[i][2] ?? (i > 0 ? route[i - 1].ele : 0),
            })
        );

        if (
            messageIdx < messages.length &&
            coordinates[i][0] == Number(messages[messageIdx][lngIdx]) / 1000000 &&
            coordinates[i][1] == Number(messages[messageIdx][latIdx]) / 1000000
        ) {
            messageIdx++;

            if (messageIdx == messages.length) tags = {};
            else tags = getTags(messages[messageIdx][tagIdx]);
        }

        route[route.length - 1].setExtensions(tags);
    }

    return route;
}

function getTags(message: string): { [key: string]: string } {
    const fields = message.split(' ');
    const tags: { [key: string]: string } = {};
    for (let i = 0; i < fields.length; i++) {
        const [key, value] = fields[i].split('=');
        tags[key.replace(/:/g, '_')] = value;
    }
    return tags;
}

function getIntermediatePoints(points: Coordinates[]): Promise<TrackPoint[]> {
    const route: TrackPoint[] = [];
    const step = 0.05;

    for (let i = 0; i < points.length - 1; i++) {
        // Add intermediate points between each pair of points
        const dist = distance(points[i], points[i + 1]) / 1000;
        for (let d = 0; d < dist; d += step) {
            const lat = points[i].lat + (d / dist) * (points[i + 1].lat - points[i].lat);
            const lon = points[i].lon + (d / dist) * (points[i + 1].lon - points[i].lon);
            route.push(
                new TrackPoint({
                    attributes: {
                        lat: lat,
                        lon: lon,
                    },
                })
            );
        }
    }

    route.push(
        new TrackPoint({
            attributes: {
                lat: points[points.length - 1].lat,
                lon: points[points.length - 1].lon,
            },
        })
    );

    return withMapterhornElevation(route);
}
