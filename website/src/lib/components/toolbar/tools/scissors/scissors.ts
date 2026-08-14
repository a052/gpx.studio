import { writable, type Writable } from 'svelte/store';

export enum SplitType {
    FILES = 'files',
    TRACKS = 'tracks',
    SEGMENTS = 'segments',
}

export const splitAs: Writable<SplitType> = writable(SplitType.FILES);
