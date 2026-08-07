<script lang="ts">
    import * as Sheet from '$lib/components/ui/sheet';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Slider } from '$lib/components/ui/slider';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';

    const { elevationGainThreshold, elevationSmoothingWindow } = settings;

    let { open = $bindable() }: { open: boolean } = $props();

    // Local mirrors of the sliders so dragging stays smooth; the persisted setting (which
    // triggers a statistics recompute) is only written on pointer release via onValueCommit.
    let elevationThresholdValue = $state($elevationGainThreshold);
    let elevationSmoothingValue = $state($elevationSmoothingWindow);
    $effect(() => {
        elevationThresholdValue = $elevationGainThreshold;
    });
    $effect(() => {
        elevationSmoothingValue = $elevationSmoothingWindow;
    });
</script>

<Sheet.Root bind:open>
    <Sheet.Trigger class="hidden" />
    <Sheet.Content>
        <Sheet.Header class="h-full">
            <Sheet.Title>{i18n._('menu.elevation_computation')}</Sheet.Title>
            <ScrollArea class="w-[105%] min-h-full pr-4">
                <div class="flex flex-col gap-4 mt-2 px-1">
                    <div class="flex flex-col gap-1.5">
                        <div class="flex items-center justify-between text-sm">
                            <span>{i18n._('menu.elevation_threshold')}</span>
                            <span class="text-muted-foreground">
                                {elevationThresholdValue} m
                            </span>
                        </div>
                        <Slider
                            type="single"
                            min={0}
                            max={20}
                            step={1}
                            bind:value={elevationThresholdValue}
                            onValueCommit={(v) => ($elevationGainThreshold = v)}
                        />
                        <p class="text-muted-foreground text-xs leading-snug">
                            {i18n._('menu.elevation_threshold_help')}
                        </p>
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <div class="flex items-center justify-between text-sm">
                            <span>{i18n._('menu.elevation_smoothing')}</span>
                            <span class="text-muted-foreground">
                                {elevationSmoothingValue} m
                            </span>
                        </div>
                        <Slider
                            type="single"
                            min={0}
                            max={100}
                            step={5}
                            bind:value={elevationSmoothingValue}
                            onValueCommit={(v) => ($elevationSmoothingWindow = v)}
                        />
                        <p class="text-muted-foreground text-xs leading-snug">
                            {i18n._('menu.elevation_smoothing_help')}
                        </p>
                    </div>
                </div>
            </ScrollArea>
        </Sheet.Header>
    </Sheet.Content>
</Sheet.Root>
