<script lang="ts">
    import * as Card from '$lib/components/ui/card';
    import * as Popover from '$lib/components/ui/popover/index.js';
    import Tooltip from '$lib/components/Tooltip.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import WithUnits from '$lib/components/WithUnits.svelte';
    import FullStatistics from '$lib/components/FullStatistics.svelte';

    import {
        ArrowDownToLine,
        List,
        MountainSnow,
        MoveDownRight,
        MoveUpRight,
        Ruler,
        Timer,
        Zap,
    } from '@lucide/svelte';

    import { i18n } from '$lib/i18n.svelte';
    import type { GPXGlobalStatistics, GPXStatisticsGroup } from 'gpx';
    import type { Readable } from 'svelte/store';
    import { settings } from '$lib/logic/settings';

    const { velocityUnits } = settings;

    let panelHeight: number = $state(0);
    let panelWidth: number = $state(0);

    let {
        gpxStatistics,
        slicedGPXStatistics,
        orientation,
    }: {
        gpxStatistics: Readable<GPXStatisticsGroup>;
        slicedGPXStatistics: Readable<[GPXGlobalStatistics, number, number] | undefined>;
        orientation: 'horizontal' | 'vertical';
    } = $props();

    let statistics = $derived(
        $slicedGPXStatistics !== undefined ? $slicedGPXStatistics[0] : $gpxStatistics.global
    );
    // Empty stats (no file selected) carry sentinel values; show 0 like the other rows.
    let maxElevation = $derived(
        Number.isFinite(statistics.elevation.max) ? statistics.elevation.max : 0
    );
    let minElevation = $derived(
        Number.isFinite(statistics.elevation.min) ? statistics.elevation.min : 0
    );
</script>

<Card.Root
    class="h-full {orientation === 'vertical'
        ? 'min-w-40 sm:min-w-44'
        : 'w-full h-fit my-1'} ring-0 p-0 text-sm sm:text-base bg-transparent"
>
    <Card.Content class="h-full p-0">
        <div
            bind:clientHeight={panelHeight}
            bind:clientWidth={panelWidth}
            class="relative flex {orientation === 'vertical'
                ? 'flex-col h-full justify-center'
                : 'flex-row w-full justify-evenly'} gap-4"
        >
            <Tooltip label={i18n._('quantities.distance')}>
                <span class="flex flex-row items-center">
                    <Ruler size="16" class="mr-1" />
                    <WithUnits value={statistics.distance.total} type="distance" />
                </span>
            </Tooltip>
            <Tooltip label={i18n._('quantities.elevation_gain_loss')}>
                <span class="flex flex-row items-center">
                    <MoveUpRight size="16" class="mr-1" />
                    <WithUnits value={statistics.elevation.gain} type="elevation" />
                    <MoveDownRight size="16" class="mx-1" />
                    <WithUnits value={statistics.elevation.loss} type="elevation" />
                </span>
            </Tooltip>
            <Tooltip label={i18n._('quantities.elevation_max_min')}>
                <span class="flex flex-row items-center">
                    <MountainSnow size="16" class="mr-1" />
                    <WithUnits value={maxElevation} type="elevation" />
                    <ArrowDownToLine size="16" class="mx-1" />
                    <WithUnits value={minElevation} type="elevation" />
                </span>
            </Tooltip>
            {#if panelHeight > 150 || (orientation === 'horizontal' && panelWidth > 450)}
                <Tooltip
                    label="{$velocityUnits === 'speed'
                        ? i18n._('quantities.speed')
                        : i18n._('quantities.pace')} ({i18n._('quantities.moving')} / {i18n._(
                        'quantities.total'
                    )})"
                >
                    <span class="flex flex-row items-center">
                        <Zap size="16" class="mr-1" />
                        <WithUnits value={statistics.speed.moving} type="speed" showUnits={false} />
                        <span class="mx-1">/</span>
                        <WithUnits value={statistics.speed.total} type="speed" />
                    </span>
                </Tooltip>
            {/if}
            {#if panelHeight > 180 || (orientation === 'horizontal' && panelWidth > 620)}
                <Tooltip
                    label="{i18n._('quantities.time')} ({i18n._('quantities.moving')} / {i18n._(
                        'quantities.total'
                    )})"
                >
                    <span class="flex flex-row items-center">
                        <Timer size="16" class="mr-1" />
                        <WithUnits value={statistics.time.moving} type="time" />
                        <span class="mx-1">/</span>
                        <WithUnits value={statistics.time.total} type="time" />
                    </span>
                </Tooltip>
            {/if}
            <div
                class={orientation === 'vertical' ? 'absolute top-0 right-0' : 'flex items-center'}
            >
                <Popover.Root>
                    <Popover.Trigger>
                        <ButtonWithTooltip
                            label={i18n._('quantities.show_all_information')}
                            variant="outline"
                            side="top"
                            class="w-7 h-7 p-0 flex justify-center opacity-70 hover:opacity-100 transition-opacity duration-300 bg-background"
                        >
                            <List size="18" />
                        </ButtonWithTooltip>
                    </Popover.Trigger>
                    <Popover.Content class="w-fit p-0 overflow-hidden" side="right" align="end">
                        <FullStatistics {statistics} />
                    </Popover.Content>
                </Popover.Root>
            </div>
        </div>
    </Card.Content>
</Card.Root>
