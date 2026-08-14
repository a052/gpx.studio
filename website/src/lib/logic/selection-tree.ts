import type { ListItem } from '$lib/components/file-list/file-list';

export class SelectionTreeType {
    item: ListItem;
    selected: boolean;
    children: {
        [key: string | number]: SelectionTreeType;
    };
    size: number = 0;

    constructor(item: ListItem) {
        this.item = item;
        this.selected = false;
        this.children = {};
    }

    clear() {
        this.selected = false;
        for (const key in this.children) {
            this.children[key].clear();
        }
        this.size = 0;
    }

    _setOrToggle(item: ListItem, value?: boolean) {
        if (item.level === this.item.level) {
            const newSelected = value === undefined ? !this.selected : value;
            if (this.selected !== newSelected) {
                this.selected = newSelected;
                this.size += this.selected ? 1 : -1;
            }
        } else {
            const id = item.getIdAtLevel(this.item.level);
            if (id !== undefined) {
                if (!Object.hasOwn(this.children, id)) {
                    this.children[id] = new SelectionTreeType(this.item.extend(id));
                }
                this.size -= this.children[id].size;
                this.children[id]._setOrToggle(item, value);
                this.size += this.children[id].size;
            }
        }
    }

    set(item: ListItem, value: boolean) {
        this._setOrToggle(item, value);
    }

    toggle(item: ListItem) {
        this._setOrToggle(item);
    }

    has(item: ListItem): boolean {
        if (item.level === this.item.level) {
            return this.selected;
        } else {
            const id = item.getIdAtLevel(this.item.level);
            if (id !== undefined) {
                if (Object.hasOwn(this.children, id)) {
                    return this.children[id].has(item);
                }
            }
        }
        return false;
    }

    hasAnyParent(item: ListItem, self: boolean = true): boolean {
        if (
            this.selected &&
            this.item.level <= item.level &&
            (self || this.item.level < item.level)
        ) {
            return this.selected;
        }
        const id = item.getIdAtLevel(this.item.level);
        if (id !== undefined) {
            if (Object.hasOwn(this.children, id)) {
                return this.children[id].hasAnyParent(item, self);
            }
        }
        return false;
    }

    hasAnyChildren(item: ListItem, self: boolean = true, ignoreIds?: (string | number)[]): boolean {
        if (
            this.selected &&
            this.item.level >= item.level &&
            (self || this.item.level > item.level)
        ) {
            return this.selected;
        }
        const id = item.getIdAtLevel(this.item.level);
        if (id !== undefined) {
            if (ignoreIds === undefined || ignoreIds.indexOf(id) === -1) {
                if (Object.hasOwn(this.children, id)) {
                    return this.children[id].hasAnyChildren(item, self, ignoreIds);
                }
            }
        } else {
            for (const key in this.children) {
                if (ignoreIds === undefined || ignoreIds.indexOf(key) === -1) {
                    if (this.children[key].hasAnyChildren(item, self, ignoreIds)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    getSelected(selection: ListItem[] = []): ListItem[] {
        if (this.selected) {
            selection.push(this.item);
        }
        for (const key in this.children) {
            this.children[key].getSelected(selection);
        }
        return selection;
    }

    forEach(callback: (item: ListItem) => void) {
        if (this.selected) {
            callback(this.item);
        }
        for (const key in this.children) {
            this.children[key].forEach(callback);
        }
    }

    getChild(id: string | number): SelectionTreeType | undefined {
        return this.children[id];
    }

    deleteChild(id: string | number) {
        if (Object.hasOwn(this.children, id)) {
            this.size -= this.children[id].size;
            delete this.children[id];
        }
    }
}
