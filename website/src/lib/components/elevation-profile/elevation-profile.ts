import { i18n } from '$lib/i18n.svelte';
import { settings } from '$lib/logic/settings';
import {
    getCadenceWithUnits,
    getConvertedDistance,
    getConvertedElevation,
    getConvertedTemperature,
    getConvertedVelocity,
    getDistanceUnits,
    getDistanceWithUnits,
    getElevationWithUnits,
    getHeartRateWithUnits,
    getPowerWithUnits,
    getTemperatureWithUnits,
    getVelocityWithUnits,
} from '$lib/units';
import Chart, {
    type ChartEvent,
    type ChartOptions,
    type ScriptableLineSegmentContext,
    type TooltipItem,
} from 'chart.js/auto';
import { get, type Readable, type Writable } from 'svelte/store';
import type { Coordinates, GPXGlobalStatistics, GPXStatisticsGroup } from 'gpx';
import { mode } from 'mode-watcher';
import {
    cadenceLineColor,
    elevationLineColor,
    getElevationColor,
    getHighwayColor,
    getSlopeColor,
    getSurfaceColor,
    heartRateLineColor,
    powerLineColor,
    speedLineColor,
    temperatureLineColor,
    withAlpha,
} from '$lib/assets/colors';

const { distanceUnits, velocityUnits, temperatureUnits } = settings;

Chart.defaults.font.family =
    'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'; // Tailwind CSS font

interface ElevationProfilePoint {
    x: number;
    y: number;
    // Always the converted distance for this point, kept regardless of the active x-axis mode so the
    // tooltip can show distance even when `x` holds elapsed time.
    distance: number;
    time?: Date;
    slope: {
        at: number;
        segment: number;
        length: number;
    };
    extensions: Record<string, any>;
    coordinates: Coordinates;
    index: number;
}

type AdditionalCurveId = 'speed' | 'hr' | 'cad' | 'atemp' | 'power';

const ADDITIONAL_CURVES: AdditionalCurveId[] = ['speed', 'hr', 'cad', 'atemp', 'power'];

// Per-curve right-axis config. Speed ticks strip trailing whole decimals
// ("12.00 km/h" → "12 km/h"); the precise value stays available in the tooltip.
const additionalCurveConfigs: Array<{
    id: AdditionalCurveId;
    color: string;
    format: (value: number) => string;
}> = [
    {
        id: 'speed',
        color: speedLineColor,
        format: (v) => getVelocityWithUnits(v, false).replace(/\.0+ /, ' '),
    },
    { id: 'hr', color: heartRateLineColor, format: (v) => getHeartRateWithUnits(v) },
    { id: 'cad', color: cadenceLineColor, format: (v) => getCadenceWithUnits(v) },
    { id: 'atemp', color: temperatureLineColor, format: (v) => getTemperatureWithUnits(v, false) },
    { id: 'power', color: powerLineColor, format: (v) => getPowerWithUnits(v) },
];

export class ElevationProfile {
    private _chart: Chart | null = null;
    private _canvas: HTMLCanvasElement;
    private _overlay: HTMLCanvasElement;
    private _dragging = false;
    private _panning = false;
    private _gradientCache: { key: string; value: CanvasGradient } | null = null;
    // The additional curve whose y-axis is currently shown on the right. The other enabled
    // curves' axes stay hidden; clicking the visible axis cycles to the next one.
    private _activeAdditionalCurve: AdditionalCurveId | null = null;
    // Whether the x-axis currently plots elapsed time (hours) instead of distance. Derived in
    // updateData() from the xAxis setting AND the presence of time data; read by the x tick
    // formatter and updateOverlay so both stay consistent with the last drawn data.
    private _useTime = false;

    private _gpxStatistics: Readable<GPXStatisticsGroup>;
    private _slicedGPXStatistics: Writable<[GPXGlobalStatistics, number, number] | undefined>;
    private _hoveredPoint: Writable<Coordinates | null>;
    private _additionalDatasets: Readable<string[]>;
    private _elevationFill: Readable<'slope' | 'surface' | 'highway' | undefined>;
    private _xAxis: Readable<'distance' | 'time'>;

    constructor(
        gpxStatistics: Readable<GPXStatisticsGroup>,
        slicedGPXStatistics: Writable<[GPXGlobalStatistics, number, number] | undefined>,
        hoveredPoint: Writable<Coordinates | null>,
        additionalDatasets: Readable<string[]>,
        elevationFill: Readable<'slope' | 'surface' | 'highway' | undefined>,
        xAxis: Readable<'distance' | 'time'>,
        canvas: HTMLCanvasElement,
        overlay: HTMLCanvasElement
    ) {
        this._gpxStatistics = gpxStatistics;
        this._slicedGPXStatistics = slicedGPXStatistics;
        this._hoveredPoint = hoveredPoint;
        this._additionalDatasets = additionalDatasets;
        this._elevationFill = elevationFill;
        this._xAxis = xAxis;
        this._canvas = canvas;
        this._overlay = overlay;

        import('chartjs-plugin-zoom').then((module) => {
            Chart.register(module.default);
            this.initialize();

            // These callbacks run inside the shared stores' notification loops. Wrapping each in a guard
            // ensures a throw during a chart update (e.g. malformed statistics) cannot propagate back out
            // of the store's .set() and abort the reactive update chain, which would freeze the whole UI.
            const guard = (fn: () => void) => {
                try {
                    fn();
                } catch (error) {
                    console.error('Elevation profile update failed:', error);
                }
            };

            this._gpxStatistics.subscribe(() => {
                guard(() => this.updateData());
            });
            this._slicedGPXStatistics.subscribe(() => {
                guard(() => this.updateOverlay());
            });
            distanceUnits.subscribe(() => {
                guard(() => this.updateData());
            });
            velocityUnits.subscribe(() => {
                guard(() => this.updateData());
            });
            temperatureUnits.subscribe(() => {
                guard(() => this.updateData());
            });
            this._additionalDatasets.subscribe(() => {
                guard(() => this.updateDataVisibility());
            });
            this._elevationFill.subscribe(() => {
                guard(() => this.updateFill());
            });
            this._xAxis.subscribe(() => {
                guard(() => this.updateData());
            });
        });
    }

    initialize() {
        const options: ChartOptions<'line'> = {
            animation: false,
            parsing: false,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    ticks: {
                        // Arrow function so it can read `this._useTime`; distance ticks append the
                        // distance unit, time ticks show elapsed decimal hours (e.g. "1.5 h").
                        callback: (value: number | string) => {
                            const formatted = (value as number).toFixed(1).replace(/\.0+$/, '');
                            return this._useTime
                                ? `${formatted} ${i18n._('units.hours')}`
                                : `${formatted} ${getDistanceUnits()}`;
                        },
                        align: 'inner',
                        maxRotation: 0,
                    },
                },
                y: {
                    type: 'linear',
                    ticks: {
                        callback: function (value: number | string) {
                            return getElevationWithUnits(value as number, false);
                        },
                    },
                },
            },
            datasets: {
                line: {
                    pointRadius: 0,
                    tension: 0.4,
                    borderWidth: 1,
                    cubicInterpolationMode: 'monotone',
                },
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false,
                },
                decimation: {
                    enabled: true,
                },
                tooltip: {
                    enabled: () => !this._dragging && !this._panning,
                    callbacks: {
                        title: () => {
                            return '';
                        },
                        label: (context: TooltipItem<'line'>) => {
                            const point = context.raw as ElevationProfilePoint;
                            if (context.datasetIndex === 0) {
                                if (this._dragging) {
                                    this._hoveredPoint.set(null);
                                } else {
                                    this._hoveredPoint.set(point.coordinates);
                                }
                                return `${i18n._('quantities.elevation')}: ${getElevationWithUnits(point.y, false)}`;
                            } else if (context.datasetIndex === 1) {
                                return `${get(velocityUnits) === 'speed' ? i18n._('quantities.speed') : i18n._('quantities.pace')}: ${getVelocityWithUnits(point.y, false)}`;
                            } else if (context.datasetIndex === 2) {
                                return `${i18n._('quantities.heartrate')}: ${getHeartRateWithUnits(point.y)}`;
                            } else if (context.datasetIndex === 3) {
                                return `${i18n._('quantities.cadence')}: ${getCadenceWithUnits(point.y)}`;
                            } else if (context.datasetIndex === 4) {
                                return `${i18n._('quantities.temperature')}: ${getTemperatureWithUnits(point.y, false)}`;
                            } else if (context.datasetIndex === 5) {
                                return `${i18n._('quantities.power')}: ${getPowerWithUnits(point.y)}`;
                            }
                        },
                        afterBody: (contexts: TooltipItem<'line'>[]) => {
                            const context = contexts.filter(
                                (context) => context.datasetIndex === 0
                            );
                            if (context.length === 0) return;
                            const point = context[0].raw as ElevationProfilePoint;
                            const slope = {
                                at: point.slope.at.toFixed(1),
                                segment: point.slope.segment.toFixed(1),
                                length: getDistanceWithUnits(point.slope.length),
                            };
                            const surface = point.extensions.surface
                                ? point.extensions.surface
                                : 'unknown';
                            const highway = point.extensions.highway
                                ? point.extensions.highway
                                : 'unknown';
                            const sacScale = point.extensions.sac_scale;
                            const mtbScale = point.extensions.mtb_scale;

                            const labels = [
                                `    ${i18n._('quantities.distance')}: ${getDistanceWithUnits(point.distance, false)}`,
                                `    ${i18n._('quantities.slope')}: ${slope.at} %${get(this._elevationFill) === 'slope' ? ` (${slope.length} @${slope.segment} %)` : ''}`,
                            ];

                            if (get(this._elevationFill) === 'surface') {
                                labels.push(
                                    `    ${i18n._('quantities.surface')}: ${i18n._(`toolbar.routing.surface.${surface}`)}`
                                );
                            }

                            if (get(this._elevationFill) === 'highway') {
                                labels.push(
                                    `    ${i18n._('quantities.highway')}: ${i18n._(`toolbar.routing.highway.${highway}`)}${
                                        sacScale
                                            ? ` (${i18n._(`toolbar.routing.sac_scale.${sacScale}`)})`
                                            : ''
                                    }`
                                );
                                if (mtbScale) {
                                    labels.push(
                                        `    ${i18n._('toolbar.routing.mtb_scale')}: ${mtbScale}`
                                    );
                                }
                            }

                            if (point.time) {
                                labels.push(
                                    `    ${i18n._('quantities.time')}: ${i18n.df.format(point.time)}`
                                );
                            }

                            return labels;
                        },
                    },
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPanStart: () => {
                            this._panning = true;
                            this._slicedGPXStatistics.set(undefined);
                            return true;
                        },
                        onPanComplete: () => {
                            this._panning = false;
                        },
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        mode: 'x',
                        onZoomStart: ({ event }: { chart: Chart; event: any }) => {
                            if (!this._chart) {
                                return false;
                            }
                            const maxZoom = this._chart.getInitialScaleBounds()?.x?.max ?? 0;
                            if (
                                event.deltaY < 0 &&
                                Math.abs(maxZoom / this._chart.getZoomLevel()) < 0.01
                            ) {
                                // Disable wheel pan if zoomed in to the max, and zooming in
                                return false;
                            }

                            this._slicedGPXStatistics.set(undefined);
                        },
                    },
                    limits: {
                        x: {
                            min: 'original',
                            max: 'original',
                            minRange: 1,
                        },
                    },
                },
            },
            onResize: () => {
                this.updateOverlay();
            },
        };

        // All additional curves have a right-hand scale registered, but only the active curve's
        // one is displayed at a time (see setVisibility) — showing all of them side by side
        // would eat a lot of horizontal space. Ticks are color-coded to the curve.
        additionalCurveConfigs.forEach(({ id, color, format }) => {
            options.scales![`y${id}`] = {
                type: 'linear',
                position: 'right',
                display: false,
                grid: {
                    display: false,
                },
                border: {
                    display: false,
                },
                ticks: {
                    callback: (value) => format(value as number),
                    color,
                    maxTicksLimit: 6,
                },
                reverse: id === 'speed' && get(velocityUnits) === 'pace',
            };
        });

        this._chart = new Chart(this._canvas, {
            type: 'line',
            data: {
                datasets: [],
            },
            options,
            plugins: [
                {
                    id: 'toggleMarker',
                    events: ['mouseout'],
                    afterEvent: (chart: Chart, args: { event: ChartEvent }) => {
                        if (args.event.type === 'mouseout') {
                            this._hoveredPoint.set(null);
                        }
                    },
                },
            ],
        });

        let startIndex = 0;
        let endIndex = 0;
        const getIndex = (evt: PointerEvent) => {
            if (!this._chart) {
                return undefined;
            }
            const points = this._chart.getElementsAtEventForMode(
                evt,
                'x',
                {
                    intersect: false,
                },
                true
            );

            if (points.length === 0) {
                const rect = this._canvas.getBoundingClientRect();
                if (evt.x - rect.left <= this._chart.chartArea.left) {
                    return 0;
                } else if (evt.x - rect.left >= this._chart.chartArea.right) {
                    return this._chart.data.datasets[0].data.length - 1;
                } else {
                    return undefined;
                }
            }

            const point = points.find((point) => (point.element as any).raw);
            if (point) {
                return (point.element as any).raw.index;
            } else {
                return points[0].index;
            }
        };

        let dragStarted = false;
        const onMouseDown = (evt: PointerEvent) => {
            if (evt.button === 2) {
                // Selection interaction (right button)
                dragStarted = true;
                this._canvas.style.cursor = 'col-resize';
                startIndex = getIndex(evt);
            } else if (evt.button === 0) {
                // Panning interaction, handled by chartjs-plugin-zoom — unless the click lands
                // on the active additional-curve axis, where it cycles to the next curve.
                if (this.isPointOnActiveAxis(evt)) {
                    this.cycleAdditionalCurve();
                } else {
                    this._canvas.style.cursor = 'grabbing';
                }
            }
        };
        const onMouseMove = (evt: PointerEvent) => {
            if (dragStarted) {
                if ((evt.buttons & 2) === 0) {
                    // Right button was released while outside the canvas (no pointer capture):
                    // end the drag instead of letting the selection follow the cursor.
                    dragStarted = false;
                    this._dragging = false;
                    this._canvas.style.cursor = '';
                    return;
                }
                this._dragging = true;
                endIndex = getIndex(evt);
                if (endIndex !== undefined) {
                    if (startIndex === undefined) {
                        startIndex = endIndex;
                    } else if (startIndex !== endIndex) {
                        try {
                            this._slicedGPXStatistics.set([
                                get(this._gpxStatistics).sliced(
                                    Math.min(startIndex, endIndex),
                                    Math.max(startIndex, endIndex)
                                ),
                                Math.min(startIndex, endIndex),
                                Math.max(startIndex, endIndex),
                            ]);
                        } catch (error) {
                            // Slice computation can throw when indices are stale (e.g. captured against a
                            // longer track, then reused after switching to a shorter one). Log and continue;
                            // the drag gesture stays active and updateOverlay will handle the stale indices.
                            console.error('Failed to update slice during drag:', error);
                        }
                    }
                }
            } else if (this.isPointOnActiveAxis(evt)) {
                // Advertise the click-to-cycle interaction on the active axis.
                this._canvas.style.cursor = 'pointer';
            } else if (this._canvas.style.cursor === 'pointer') {
                this._canvas.style.cursor = '';
            }
        };
        const onMouseUp = (evt: PointerEvent) => {
            if (!dragStarted) {
                return;
            }
            try {
                endIndex = getIndex(evt);
                if (startIndex === endIndex) {
                    this._slicedGPXStatistics.set(undefined);
                }
            } finally {
                // Always reset drag state even if the slice-set threw, so the UI doesn't stay frozen.
                dragStarted = false;
                this._dragging = false;
                this._canvas.style.cursor = '';
            }
        };
        this._canvas.addEventListener('pointerdown', onMouseDown);
        this._canvas.addEventListener('pointermove', onMouseMove);
        this._canvas.addEventListener('pointerup', onMouseUp);
        this._canvas.addEventListener('contextmenu', (evt) => {
            evt.preventDefault();
        });
    }

    updateData() {
        if (!this._chart) {
            return;
        }
        const data = get(this._gpxStatistics);
        const units = {
            distance: get(distanceUnits),
            velocity: get(velocityUnits),
            temperature: get(temperatureUnits),
        };

        // Effective x-axis mode: only plot elapsed time when the setting asks for it AND the file
        // actually has timestamps; otherwise fall back to distance so untimed tracks still render.
        const hasTime = data.global.time.total > 0 && data.global.time.start !== undefined;
        this._useTime = get(this._xAxis) === 'time' && hasTime;
        const startMs = this._useTime ? data.global.time.start!.getTime() : 0;
        // Elapsed hours are computed from the raw timestamps (so multi-segment gaps are included,
        // matching global.time.total). Carry the last value forward for the rare timeless point.
        let lastHours = 0;

        const datasets: Array<Array<any>> = [[], [], [], [], [], []];
        data.forEachTrackPoint((trkpt, distance, speed, slope, index) => {
            const convertedDistance = getConvertedDistance(distance, units.distance);
            // Every dataset shares this x for the same index, keeping the curves aligned.
            let x: number;
            if (this._useTime) {
                if (trkpt.time) {
                    lastHours = (trkpt.time.getTime() - startMs) / 3600000;
                }
                x = lastHours;
            } else {
                x = convertedDistance;
            }
            datasets[0].push({
                x: x,
                y: trkpt.ele ? getConvertedElevation(trkpt.ele, units.distance) : 0,
                distance: convertedDistance,
                time: trkpt.time,
                slope: slope,
                extensions: trkpt.getExtensions(),
                coordinates: trkpt.getCoordinates(),
                index: index,
            });
            if (data.global.time.total > 0) {
                datasets[1].push({
                    x: x,
                    y: getConvertedVelocity(speed, units.velocity, units.distance),
                    index: index,
                });
            }
            if (data.global.hr.count > 0) {
                datasets[2].push({
                    x: x,
                    y: trkpt.getHeartRate(),
                    index: index,
                });
            }
            if (data.global.cad.count > 0) {
                datasets[3].push({
                    x: x,
                    y: trkpt.getCadence(),
                    index: index,
                });
            }
            if (data.global.atemp.count > 0) {
                datasets[4].push({
                    x: x,
                    y: getConvertedTemperature(trkpt.getTemperature(), units.temperature),
                    index: index,
                });
            }
            if (data.global.power.count > 0) {
                datasets[5].push({
                    x: x,
                    y: trkpt.getPower(),
                    index: index,
                });
            }
        });

        this._chart.data.datasets[0] = {
            label: i18n._('quantities.elevation'),
            data: datasets[0],
            normalized: true,
            fill: 'start',
            order: 1,
            segment: {},
            // Dataset-level colors are what the tooltip swatch uses (segment colors are not);
            // the per-segment callbacks set in setFill() override these when drawing.
            borderColor: elevationLineColor,
            backgroundColor: withAlpha(elevationLineColor),
        };
        this._chart.data.datasets[1] = {
            data: datasets[1],
            normalized: true,
            yAxisID: 'yspeed',
            borderColor: speedLineColor,
            backgroundColor: withAlpha(speedLineColor),
        };
        this._chart.data.datasets[2] = {
            data: datasets[2],
            normalized: true,
            yAxisID: 'yhr',
            borderColor: heartRateLineColor,
            backgroundColor: withAlpha(heartRateLineColor),
        };
        this._chart.data.datasets[3] = {
            data: datasets[3],
            normalized: true,
            yAxisID: 'ycad',
            borderColor: cadenceLineColor,
            backgroundColor: withAlpha(cadenceLineColor),
        };
        this._chart.data.datasets[4] = {
            data: datasets[4],
            normalized: true,
            yAxisID: 'yatemp',
            borderColor: temperatureLineColor,
            backgroundColor: withAlpha(temperatureLineColor),
        };
        this._chart.data.datasets[5] = {
            data: datasets[5],
            normalized: true,
            yAxisID: 'ypower',
            borderColor: powerLineColor,
            backgroundColor: withAlpha(powerLineColor),
        };

        this._chart.options.scales!.x!['min'] = 0;
        this._chart.options.scales!.x!['max'] = this._useTime
            ? data.global.time.total / 3600
            : getConvertedDistance(data.global.distance.total, units.distance);

        this.setVisibility();
        this.setFill();

        this._chart.update();
    }

    updateDataVisibility() {
        if (!this._chart) {
            return;
        }
        this.setVisibility();
        this._chart.update();
    }

    setVisibility() {
        if (!this._chart) {
            return;
        }

        const additionalDatasets = get(this._additionalDatasets);

        if (this._chart.data.datasets.length == 6) {
            // Also hide datasets with no data (curve not present in this file), so they don't
            // render an empty curve and never become candidates for the active axis.
            for (let i = 1; i < 6; i++) {
                const dataset = this._chart.data.datasets[i];
                dataset.hidden =
                    !additionalDatasets.includes(ADDITIONAL_CURVES[i - 1]) ||
                    dataset.data.length === 0;
            }
        }

        // Curves currently enabled (visible and present in the file), in canonical order.
        const enabledCurves = this.getEnabledAdditionalCurves();

        // Keep the active curve valid: fall back to the first enabled curve, or none if
        // the user disabled it or the file doesn't contain that data.
        if (
            this._activeAdditionalCurve === null ||
            !enabledCurves.includes(this._activeAdditionalCurve)
        ) {
            this._activeAdditionalCurve = enabledCurves[0] ?? null;
        }

        // Only the active curve gets its right-hand axis; the others stay hidden.
        additionalCurveConfigs.forEach(({ id }) => {
            const scale = this._chart?.options.scales?.[`y${id}`];
            if (scale) {
                scale.display = id === this._activeAdditionalCurve;
            }
        });
    }

    updateFill() {
        if (!this._chart) {
            return;
        }
        this.setFill();
        this._chart.update();
    }

    setFill() {
        if (!this._chart) {
            return;
        }
        const elevationFill = get(this._elevationFill);
        const dataset = this._chart.data.datasets[0];
        // The curve line uses the same dark-red color in every fill mode; only the fill varies.
        // Applied through `segment`, which overrides the dataset-level colors (kept in
        // updateData for the tooltip swatch) when drawing.
        let backgroundColor: any;
        if (elevationFill === 'slope') {
            backgroundColor = this.slopeFillCallback;
        } else if (elevationFill === 'surface') {
            backgroundColor = this.surfaceFillCallback;
        } else if (elevationFill === 'highway') {
            backgroundColor = this.highwayFillCallback;
        } else {
            // Default (no fill mode): vertical gradient keyed to elevation.
            backgroundColor = this.elevationGradientFillCallback;
        }
        Object.assign(dataset, {
            segment: { backgroundColor, borderColor: elevationLineColor },
        });
    }

    // Curves currently enabled (visible and present in the file), in canonical order.
    getEnabledAdditionalCurves(): AdditionalCurveId[] {
        if (!this._chart || this._chart.data.datasets.length != 6) {
            return [];
        }
        return ADDITIONAL_CURVES.filter((id, i) => {
            const dataset = this._chart?.data.datasets[i + 1];
            return dataset !== undefined && !dataset.hidden;
        });
    }

    // Is the pointer over the active additional-curve axis (its tick-label strip on the
    // right edge of the chart)? Used both for the click-to-cycle interaction and to show
    // a pointer cursor on hover.
    isPointOnActiveAxis(evt: PointerEvent | MouseEvent): boolean {
        if (!this._chart || this._activeAdditionalCurve === null) {
            return false;
        }
        const scale = this._chart.scales[`y${this._activeAdditionalCurve}`];
        if (!scale) {
            return false;
        }
        const rect = this._canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        return x >= scale.left && x <= scale.right && y >= scale.top && y <= scale.bottom;
    }

    // Switch the right-hand axis to the next enabled additional curve (wraps around).
    cycleAdditionalCurve() {
        if (!this._chart) {
            return;
        }
        const enabledCurves = this.getEnabledAdditionalCurves();
        if (enabledCurves.length < 2) {
            // Nothing to cycle to — keep the single enabled axis (if any).
            return;
        }
        const currentIndex = this._activeAdditionalCurve
            ? enabledCurves.indexOf(this._activeAdditionalCurve)
            : -1;
        this._activeAdditionalCurve = enabledCurves[(currentIndex + 1) % enabledCurves.length];
        this.setVisibility();
        this._chart.update();
    }

    updateOverlay() {
        if (!this._chart) {
            return;
        }

        this._overlay.width = this._canvas.width / window.devicePixelRatio;
        this._overlay.height = this._canvas.height / window.devicePixelRatio;
        this._overlay.style.width = `${this._overlay.width}px`;
        this._overlay.style.height = `${this._overlay.height}px`;

        const slicedGPXStatistics = get(this._slicedGPXStatistics);
        if (slicedGPXStatistics) {
            const startIndex = slicedGPXStatistics[1];
            const endIndex = slicedGPXStatistics[2];

            // Draw selection rectangle
            const selectionContext = this._overlay.getContext('2d');
            if (selectionContext) {
                selectionContext.fillStyle = mode.current === 'dark' ? 'white' : 'black';
                selectionContext.globalAlpha = mode.current === 'dark' ? 0.2 : 0.1;
                selectionContext.clearRect(0, 0, this._overlay.width, this._overlay.height);

                const gpxStatistics = get(this._gpxStatistics);
                // Map a point index to its x-scale value, matching the active axis mode so the
                // selection rectangle lines up with the plotted curves.
                const startMs = gpxStatistics.global.time.start?.getTime() ?? 0;
                const xValueForIndex = (index: number) => {
                    const point = gpxStatistics.getTrackPoint(index);
                    if (this._useTime) {
                        return point?.trkpt.time
                            ? (point.trkpt.time.getTime() - startMs) / 3600000
                            : (point?.time.total ?? 0) / 3600;
                    }
                    return getConvertedDistance(point?.distance.total ?? 0);
                };
                const startPixel = this._chart.scales.x.getPixelForValue(
                    xValueForIndex(startIndex)
                );
                const endPixel = this._chart.scales.x.getPixelForValue(xValueForIndex(endIndex));

                selectionContext.fillRect(
                    startPixel,
                    this._chart.chartArea.top,
                    endPixel - startPixel,
                    this._chart.chartArea.height
                );
            }
        } else if (this._overlay) {
            const selectionContext = this._overlay.getContext('2d');
            if (selectionContext) {
                selectionContext.clearRect(0, 0, this._overlay.width, this._overlay.height);
            }
        }
    }

    slopeFillCallback(context: ScriptableLineSegmentContext & { p0: { raw: any } }) {
        const point = context.p0.raw as ElevationProfilePoint;
        return getSlopeColor(point.slope.segment);
    }

    surfaceFillCallback(context: ScriptableLineSegmentContext & { p0: { raw: any } }) {
        const point = context.p0.raw as ElevationProfilePoint;
        return getSurfaceColor(point.extensions.surface);
    }

    highwayFillCallback(context: ScriptableLineSegmentContext & { p0: { raw: any } }) {
        const point = context.p0.raw as ElevationProfilePoint;
        return getHighwayColor(
            point.extensions.highway,
            point.extensions.sac_scale,
            point.extensions.mtb_scale
        );
    }

    // Arrow function so `this` resolves to the instance (needs `this._chart`). Returns the same
    // cached gradient for every segment: because the gradient is defined in absolute canvas
    // coordinates (chartArea.top → bottom), reusing it yields one seamless vertical gradient across
    // the whole fill instead of rebuilding it once per line segment.
    elevationGradientFillCallback = (): CanvasGradient | undefined => {
        if (!this._chart) {
            return undefined;
        }
        const { ctx, chartArea } = this._chart;
        if (!chartArea || chartArea.bottom <= chartArea.top) {
            // Layout not ready yet; Chart.js re-resolves the scriptable on the next draw.
            return undefined;
        }
        const key = `${Math.round(chartArea.top)}-${Math.round(chartArea.bottom)}`;
        if (this._gradientCache && this._gradientCache.key === key) {
            return this._gradientCache.value;
        }
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            // Top (i = 0) = highest elevation = red (t = 1); bottom = lowest = green (t = 0).
            gradient.addColorStop(i / steps, getElevationColor(1 - i / steps));
        }
        this._gradientCache = { key, value: gradient };
        return gradient;
    };

    destroy() {
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
}
