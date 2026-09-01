<script lang="ts">
    import { X } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { cleanMode, setCleanMode } from '$lib/logic/clean-mode';

    // The only affordance left on screen in clean mode, and it stays invisible until the pointer
    // comes near it. Reveal is driven by pointer *proximity* rather than `:hover` on purpose: a
    // hoverable-but-invisible element would put a click-eating patch over the corner of the map.

    // How close (in px) the pointer must get to the top-right corner before the button fades in.
    const REVEAL_RADIUS = 120;
    // Touch and pen have no hover, so a tap reveals the button for this long instead.
    const TOUCH_REVEAL_MS = 4000;

    let visible = $state(false);
    let hideTimeout: ReturnType<typeof setTimeout> | undefined = undefined;

    function clearHideTimeout() {
        if (hideTimeout !== undefined) {
            clearTimeout(hideTimeout);
            hideTimeout = undefined;
        }
    }

    function onPointerMove(e: PointerEvent) {
        if (e.pointerType !== 'mouse') {
            return;
        }
        clearHideTimeout();
        const dx = window.innerWidth - e.clientX;
        const dy = e.clientY;
        visible = dx >= 0 && dy >= 0 && Math.hypot(dx, dy) < REVEAL_RADIUS;
    }

    function onPointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse') {
            return;
        }
        clearHideTimeout();
        visible = true;
        hideTimeout = setTimeout(() => {
            visible = false;
            hideTimeout = undefined;
        }, TOUCH_REVEAL_MS);
    }

    $effect(() => {
        if (!$cleanMode) {
            return;
        }
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerdown', onPointerDown);
            clearHideTimeout();
            visible = false;
        };
    });
</script>

{#if $cleanMode}
    <!-- pointer-events-none on the wrapper, and on the button until it is revealed, so panning and
         zooming the map still work everywhere including this corner. -->
    <div class="absolute top-0 right-0 z-40 p-[10px] pointer-events-none">
        <button
            aria-label={i18n._('menu.exit_clean_mode')}
            title={i18n._('menu.exit_clean_mode')}
            class="w-[29px] h-[29px] flex items-center justify-center bg-background rounded shadow-md transition-opacity duration-200 focus-visible:opacity-100 focus-visible:pointer-events-auto {visible
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0'}"
            onclick={() => setCleanMode(false)}
        >
            <X size="16" />
        </button>
    </div>
{/if}
