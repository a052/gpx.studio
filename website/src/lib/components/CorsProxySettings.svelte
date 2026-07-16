<script lang="ts">
    import * as Sheet from '$lib/components/ui/sheet';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Label } from '$lib/components/ui/label';
    import { Input } from '$lib/components/ui/input';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';

    const { corsProxyUrl } = settings;

    let { open = $bindable() }: { open: boolean } = $props();
</script>

<Sheet.Root bind:open>
    <Sheet.Trigger class="hidden" />
    <Sheet.Content>
        <Sheet.Header class="h-full">
            <Sheet.Title>{i18n._('menu.cors_proxy.title')}</Sheet.Title>
            <ScrollArea class="w-[105%] min-h-full pr-4">
                <Sheet.Description>
                    {i18n._('menu.cors_proxy.help')}
                </Sheet.Description>
                <div class="flex flex-col gap-4 mt-2 px-1">
                    <div class="flex flex-col gap-1.5">
                        <Label>{i18n._('menu.cors_proxy.url')}</Label>
                        <Input
                            type="text"
                            autocomplete="off"
                            spellcheck="false"
                            placeholder="https://your-proxy.example/"
                            bind:value={$corsProxyUrl}
                        />
                        <p class="text-xs text-muted-foreground leading-snug">
                            {i18n._('menu.cors_proxy.url_help')}
                        </p>
                    </div>
                </div>
            </ScrollArea>
        </Sheet.Header>
    </Sheet.Content>
</Sheet.Root>
