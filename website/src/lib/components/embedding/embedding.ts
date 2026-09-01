import { basemaps } from '$lib/assets/layers';

export type EmbeddingOptions = {
    files: string[];
    ids: string[];
    basemap: string;
    elevation: {
        show: boolean;
        height: number;
        controls: boolean;
        fill: 'slope' | 'surface' | 'highway' | 'none';
        speed: boolean;
        hr: boolean;
        cad: boolean;
        temp: boolean;
        power: boolean;
    };
    distanceMarkers: boolean;
    directionMarkers: boolean;
    distanceUnits: 'metric' | 'imperial' | 'nautical';
    velocityUnits: 'speed' | 'pace';
    temperatureUnits: 'celsius' | 'fahrenheit';
    theme: 'system' | 'light' | 'dark';
};

export const defaultEmbeddingOptions = {
    files: [],
    ids: [],
    basemap: 'openStreetMap',
    elevation: {
        show: true,
        height: 170,
        controls: true,
        fill: 'none',
        speed: false,
        hr: false,
        cad: false,
        temp: false,
        power: false,
    },
    distanceMarkers: false,
    directionMarkers: false,
    distanceUnits: 'metric',
    velocityUnits: 'speed',
    temperatureUnits: 'celsius',
    theme: 'system',
};

// An options object before validation: arbitrary JSON, either straight from the ?options= query
// parameter or a partial override built by the playground. getMergedEmbeddingOptions folds one of
// these onto the defaults to produce a complete EmbeddingOptions.
type EmbeddingOptionsInput = Record<string, unknown>;

export function getMergedEmbeddingOptions(
    options: EmbeddingOptionsInput,
    defaultOptions: EmbeddingOptionsInput = defaultEmbeddingOptions
): EmbeddingOptions {
    const mergedOptions: EmbeddingOptionsInput = JSON.parse(JSON.stringify(defaultOptions));
    for (const key in options) {
        if (
            typeof options[key] === 'object' &&
            options[key] !== null &&
            !Array.isArray(options[key])
        ) {
            mergedOptions[key] = getMergedEmbeddingOptions(
                options[key] as EmbeddingOptionsInput,
                defaultOptions[key] as EmbeddingOptionsInput
            );
        } else {
            mergedOptions[key] = options[key];
        }
    }
    return mergedOptions as EmbeddingOptions;
}

export function getCleanedEmbeddingOptions(
    options: EmbeddingOptionsInput,
    defaultOptions: EmbeddingOptionsInput = defaultEmbeddingOptions
): EmbeddingOptionsInput {
    const cleanedOptions: EmbeddingOptionsInput = JSON.parse(JSON.stringify(options));
    for (const key in cleanedOptions) {
        if (
            typeof cleanedOptions[key] === 'object' &&
            cleanedOptions[key] !== null &&
            !Array.isArray(cleanedOptions[key])
        ) {
            cleanedOptions[key] = getCleanedEmbeddingOptions(
                cleanedOptions[key] as EmbeddingOptionsInput,
                defaultOptions[key] as EmbeddingOptionsInput
            );
            if (Object.keys(cleanedOptions[key] as EmbeddingOptionsInput).length === 0) {
                delete cleanedOptions[key];
            }
        } else if (JSON.stringify(cleanedOptions[key]) === JSON.stringify(defaultOptions[key])) {
            delete cleanedOptions[key];
        }
    }
    return cleanedOptions;
}

export const allowedEmbeddingBasemaps = Object.keys(basemaps).filter(
    (basemap) => !['ordnanceSurvey'].includes(basemap)
);

export function getFilesFromEmbeddingOptions(options: EmbeddingOptions): string[] {
    return options.files.concat(options.ids.map((id) => getURLForGoogleDriveFile(id)));
}

export function getURLForGoogleDriveFile(fileId: string): string {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=AIzaSyA2ZadQob_hXiT2VaYIkAyafPvz_4ZMssk`;
}

export function convertOldEmbeddingOptions(
    options: URLSearchParams
): EmbeddingOptionsInput & { files: string[]; ids: string[] } {
    const newOptions: EmbeddingOptionsInput & { files: string[]; ids: string[] } = {
        files: [],
        ids: [],
    };
    if (options.has('state')) {
        const state = JSON.parse(options.get('state')!);
        if (state.ids) {
            newOptions.ids.push(...state.ids);
        }
        if (state.urls) {
            newOptions.files.push(...state.urls);
        }
    }
    if (options.has('source')) {
        const basemap = options.get('source')!;
        if (basemap === 'satellite') {
            newOptions.basemap = 'esriSatellite';
        } else if (basemap === 'otm') {
            newOptions.basemap = 'openTopoMap';
        } else if (basemap === 'ohm') {
            newOptions.basemap = 'openHikingMap';
        }
    }
    if (options.has('imperial')) {
        newOptions.distanceUnits = 'imperial';
    }
    if (options.has('running')) {
        newOptions.velocityUnits = 'pace';
    }
    if (options.has('distance')) {
        newOptions.distanceMarkers = true;
    }
    if (options.has('direction')) {
        newOptions.directionMarkers = true;
    }
    if (options.has('slope')) {
        newOptions.elevation = {
            fill: 'slope',
        };
    }
    return newOptions;
}
