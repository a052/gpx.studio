<script lang="ts">
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { ChartArea, Coins, Milestone } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';

    const { distanceMarkers, directionMarkers, elevationProfile } = settings;
</script>

<div class="shrink-0 h-full flex flex-row items-center gap-1 px-1 pointer-events-auto">
    <ButtonWithTooltip
        variant="outline"
        side="top"
        label={i18n._('menu.distance_markers')}
        class="w-7 h-7 p-0 flex justify-center opacity-70 hover:opacity-100 transition-opacity duration-300 bg-background"
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
        class="w-7 h-7 p-0 flex justify-center opacity-70 hover:opacity-100 transition-opacity duration-300 bg-background"
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
        class="w-7 h-7 p-0 flex justify-center opacity-70 hover:opacity-100 transition-opacity duration-300 bg-background"
        onclick={() => {
            $elevationProfile = !$elevationProfile;
        }}
    >
        <ChartArea size="16" color={$elevationProfile ? '#33b5e5' : 'currentColor'} />
    </ButtonWithTooltip>
</div>
