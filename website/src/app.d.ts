// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import type maplibregl from 'maplibre-gl';

declare global {
    namespace App {
        // interface Error {}
        // interface Locals {}
        // interface PageData {}
        // interface PageState {}
        // interface Platform {}
    }

    interface Window {
        _map?: maplibregl.Map;
    }
}

export {};
