<script lang="ts">
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { Bookmark, ChartArea, Coins, Milestone } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';

    const { distanceMarkers, directionMarkers, elevationProfile, showWaypoints } = settings;
</script>

<div class="shrink-0 h-full flex flex-row items-center gap-1 px-1 pointer-events-auto">
    <ButtonWithTooltip
        variant="outline"
        side="top"
        label={i18n._('menu.points_of_interest')}
        class="w-[29px] h-[29px] p-0 flex justify-center bg-background dark:bg-background hover:bg-background dark:hover:bg-background border-0 shadow-md"
        onclick={() => {
            $showWaypoints = !$showWaypoints;
        }}
    >
        <Bookmark size="16" color={$showWaypoints ? '#33b5e5' : 'currentColor'} />
    </ButtonWithTooltip>
    <ButtonWithTooltip
        variant="outline"
        side="top"
        label={i18n._('menu.distance_markers')}
        class="w-[29px] h-[29px] p-0 flex justify-center bg-background dark:bg-background hover:bg-background dark:hover:bg-background border-0 shadow-md"
        onclick={() => {
            $distanceMarkers = !$distanceMarkers;
        }}
    >
        <Coins size="16" color={$distanceMarkers ? '#33b5e5' : 'currentColor'} />
    </ButtonWithTooltip>
    <ButtonWithTooltip
        variant="outline"
        side="top"
        label={i18n._('menu.direction_markers')}
        class="w-[29px] h-[29px] p-0 flex justify-center bg-background dark:bg-background hover:bg-background dark:hover:bg-background border-0 shadow-md"
        onclick={() => {
            $directionMarkers = !$directionMarkers;
        }}
    >
        <Milestone size="16" color={$directionMarkers ? '#33b5e5' : 'currentColor'} />
    </ButtonWithTooltip>
    <ButtonWithTooltip
        variant="outline"
        side="top"
        label={i18n._('menu.elevation_profile')}
        class="w-[29px] h-[29px] p-0 flex justify-center bg-background dark:bg-background hover:bg-background dark:hover:bg-background border-0 shadow-md"
        onclick={() => {
            $elevationProfile = !$elevationProfile;
        }}
    >
        <ChartArea size="16" color={$elevationProfile ? '#33b5e5' : 'currentColor'} />
    </ButtonWithTooltip>
</div>
