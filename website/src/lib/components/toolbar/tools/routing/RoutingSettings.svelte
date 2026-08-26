<script lang="ts">
    import * as Sheet from '$lib/components/ui/sheet';
    import * as Select from '$lib/components/ui/select';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Label } from '$lib/components/ui/label';
    import { Input } from '$lib/components/ui/input';
    import { TriangleAlert } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';

    const { routingProvider, graphhopperApiKey, graphhopperCustomUrl } = settings;

    let { open = $bindable() }: { open: boolean } = $props();

    const providers = ['default', 'official', 'custom', 'brouter'];
</script>

<Sheet.Root bind:open>
    <Sheet.Trigger class="hidden" />
    <Sheet.Content>
        <Sheet.Header class="h-full">
            <Sheet.Title>{i18n._('toolbar.routing.provider.title')}</Sheet.Title>
            <ScrollArea class="w-[105%] min-h-full pr-4">
                <Sheet.Description>
                    {i18n._('toolbar.routing.provider.help')}
                </Sheet.Description>
                <div class="flex flex-col gap-4 mt-2 px-1">
                    <div class="flex flex-col gap-1.5">
                        <Label>{i18n._('toolbar.routing.provider.provider')}</Label>
                        <Select.Root type="single" bind:value={$routingProvider}>
                            <Select.Trigger class="w-full" size="sm">
                                {i18n._(`toolbar.routing.provider.providers.${$routingProvider}`)}
                            </Select.Trigger>
                            <Select.Content>
                                {#each providers as provider (provider)}
                                    <Select.Item value={provider}>
                                        {i18n._(`toolbar.routing.provider.providers.${provider}`)}
                                    </Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    </div>

                    {#if $routingProvider === 'official'}
                        <div class="flex flex-col gap-1.5">
                            <Label>{i18n._('toolbar.routing.provider.api_key')}</Label>
                            <Input
                                type="text"
                                autocomplete="off"
                                spellcheck="false"
                                placeholder={i18n._('toolbar.routing.provider.api_key_placeholder')}
                                bind:value={$graphhopperApiKey}
                            />
                            <p
                                class="flex flex-row gap-1.5 text-xs text-muted-foreground leading-snug"
                            >
                                <TriangleAlert size="14" class="shrink-0 mt-0.5" />
                                {i18n._('toolbar.routing.provider.official_warning')}
                            </p>
                        </div>
                    {:else if $routingProvider === 'custom'}
                        <div class="flex flex-col gap-1.5">
                            <Label>{i18n._('toolbar.routing.provider.custom_url')}</Label>
                            <Input
                                type="text"
                                autocomplete="off"
                                spellcheck="false"
                                placeholder="https://graphhopper.gpx.studio/route"
                                bind:value={$graphhopperCustomUrl}
                            />
                            <p class="text-xs text-muted-foreground leading-snug">
                                {i18n._('toolbar.routing.provider.custom_url_help')}
                            </p>
                        </div>
                    {/if}
                </div>
            </ScrollArea>
        </Sheet.Header>
    </Sheet.Content>
</Sheet.Root>
