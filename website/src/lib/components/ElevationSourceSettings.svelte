<script lang="ts">
    import * as Sheet from '$lib/components/ui/sheet';
    import * as Select from '$lib/components/ui/select';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Label } from '$lib/components/ui/label';
    import { Input } from '$lib/components/ui/input';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import { elevationSourcePresets } from '$lib/logic/elevation-source';

    const { elevationSource, elevationSourceCustomUrl } = settings;

    let { open = $bindable() }: { open: boolean } = $props();
</script>

<Sheet.Root bind:open>
    <Sheet.Trigger class="hidden" />
    <Sheet.Content>
        <Sheet.Header class="h-full">
            <Sheet.Title>{i18n._('menu.elevation_source.title')}</Sheet.Title>
            <ScrollArea class="w-[105%] min-h-full pr-4">
                <Sheet.Description>
                    {i18n._('menu.elevation_source.help')}
                </Sheet.Description>
                <div class="flex flex-col gap-4 mt-2 px-1">
                    <div class="flex flex-col gap-1.5">
                        <Label>{i18n._('menu.elevation_source.source')}</Label>
                        <Select.Root type="single" bind:value={$elevationSource}>
                            <Select.Trigger class="w-full" size="sm">
                                {i18n._(`menu.elevation_source.sources.${$elevationSource}`)}
                            </Select.Trigger>
                            <Select.Content>
                                {#each elevationSourcePresets as source (source)}
                                    <Select.Item value={source}>
                                        {i18n._(`menu.elevation_source.sources.${source}`)}
                                    </Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    </div>

                    {#if $elevationSource === 'custom'}
                        <div class="flex flex-col gap-1.5">
                            <Label>{i18n._('menu.elevation_source.custom_url')}</Label>
                            <Input
                                type="text"
                                autocomplete="off"
                                spellcheck="false"
                                placeholder={'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'}
                                bind:value={$elevationSourceCustomUrl}
                            />
                            <p class="text-xs text-muted-foreground leading-snug">
                                {i18n._('menu.elevation_source.custom_url_help')}
                            </p>
                        </div>
                    {/if}
                </div>
            </ScrollArea>
        </Sheet.Header>
    </Sheet.Content>
</Sheet.Root>
