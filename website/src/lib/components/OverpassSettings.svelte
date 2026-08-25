<script lang="ts">
    import * as Sheet from '$lib/components/ui/sheet';
    import * as Select from '$lib/components/ui/select';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Label } from '$lib/components/ui/label';
    import { Input } from '$lib/components/ui/input';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';

    const { overpassProvider, overpassCustomUrl } = settings;

    let { open = $bindable() }: { open: boolean } = $props();

    const providers = ['default', 'custom'];
</script>

<Sheet.Root bind:open>
    <Sheet.Trigger class="hidden" />
    <Sheet.Content>
        <Sheet.Header class="h-full">
            <Sheet.Title>{i18n._('menu.overpass.title')}</Sheet.Title>
            <ScrollArea class="w-[105%] min-h-full pr-4">
                <Sheet.Description>
                    {i18n._('menu.overpass.help')}
                </Sheet.Description>
                <div class="flex flex-col gap-4 mt-2 px-1">
                    <div class="flex flex-col gap-1.5">
                        <Label>{i18n._('menu.overpass.provider')}</Label>
                        <Select.Root type="single" bind:value={$overpassProvider}>
                            <Select.Trigger class="w-full" size="sm">
                                {i18n._(`menu.overpass.providers.${$overpassProvider}`)}
                            </Select.Trigger>
                            <Select.Content>
                                {#each providers as provider (provider)}
                                    <Select.Item value={provider}>
                                        {i18n._(`menu.overpass.providers.${provider}`)}
                                    </Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    </div>

                    {#if $overpassProvider === 'custom'}
                        <div class="flex flex-col gap-1.5">
                            <Label>{i18n._('menu.overpass.custom_url')}</Label>
                            <Input
                                type="text"
                                autocomplete="off"
                                spellcheck="false"
                                placeholder="https://overpass-api.de/api/interpreter"
                                bind:value={$overpassCustomUrl}
                            />
                            <p class="text-xs text-muted-foreground leading-snug">
                                {i18n._('menu.overpass.custom_url_help')}
                            </p>
                        </div>
                    {/if}
                </div>
            </ScrollArea>
        </Sheet.Header>
    </Sheet.Content>
</Sheet.Root>
