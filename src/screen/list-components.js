/**
 * Reusable screen components for V2 architecture
 */

import React, { useState, useEffect, useRef, createElement } from "react";
import { Box, Text } from "ink";
import { ScreenRow, ScreenDivider } from "./components.js";
import {
    BAR_THUMB,
    BAR_TRACK,
    PAGE_SCROLL_KEY_BINDINGS,
    scrollbarGlyphs,
} from "./scrollbar.js";

const h = createElement;

/**
 * Make room for a 1-cell scrollbar. Full-width table rows are padEnd'd (trailing
 * space) — trim one cell. Short labels are left alone (bar just appends).
 */
function clipNameForScrollbar(name, needsBar) {
    if (!needsBar || name == null) return name;
    const s = String(name);
    if (s.length <= 1) return s;
    if (/\s$/.test(s)) return s.slice(0, -1);
    return s;
}

// TODO: Define proper context type interface




















































/**
 * Multi-column list component
 * Handles its own navigation, actions, and key bindings
 */
export function MultiColumnListComponent({ items, ctx, selectedIndexRef }) {
    const [, forceUpdate] = useState({});

    // Calculate layout
    const termWidth = (process.stdout.columns || 80) - 8;
    const maxItemLength = Math.max(...items.map(w => w.length));
    const columnWidth = maxItemLength + 3;
    const columns = Math.max(1, Math.floor(termWidth / columnWidth));
    const itemsPerColumn = Math.ceil(items.length / columns);

    // Set up actions in useEffect (runs once)
    useEffect(() => {
        ctx.setAction("moveUp", () => {
            selectedIndexRef.current = Math.max(0, selectedIndexRef.current - 1);
            forceUpdate({});
        });

        ctx.setAction("moveDown", () => {
            selectedIndexRef.current = Math.min(items.length - 1, selectedIndexRef.current + 1);
            forceUpdate({});
        });

        ctx.setAction("moveLeft", () => {
            if (selectedIndexRef.current === 0) {
                ctx.goBack();
            } else {
                selectedIndexRef.current = Math.max(0, selectedIndexRef.current - itemsPerColumn);
                forceUpdate({});
            }
        });

        ctx.setAction("moveRight", () => {
            selectedIndexRef.current = Math.min(items.length - 1, selectedIndexRef.current + itemsPerColumn);
            forceUpdate({});
        });

        // Set up key bindings
        ctx.setKeyBinding([
            { key: "leftArrow", caption: "navigate", action: "moveLeft", order: 0 },
            { key: "rightArrow", caption: "navigate", action: "moveRight", order: 0 },
            { key: "upArrow", caption: "navigate", action: "moveUp", order: 0 },
            { key: "downArrow", caption: "navigate", action: "moveDown", order: 0 }
        ]);

        // Add footer
        ctx.addFooter(`Total: ${items.length} items`);
    }, []);

    const selectedIndex = selectedIndexRef.current;

    // Build grid
    const rows = [];
    for (let row = 0; row < itemsPerColumn; row++) {
        const cols = [];
        for (let col = 0; col < columns; col++) {
            const index = col * itemsPerColumn + row;
            if (index < items.length) {
                const isSelected = index === selectedIndex;
                cols.push(
                    h(Box, { key: index, width: columnWidth },
                        h(Text, {
                            color: isSelected ? "black" : "white",
                            backgroundColor: isSelected ? "cyan" : undefined,
                            bold: isSelected
                        }, items[index].padEnd(maxItemLength))
                    )
                );
            }
        }
        rows.push(
            h(ScreenRow, { key: row, children: h(Box, { flexDirection: "row" }, ...cols) })
        );
    }

    return h(Box, { flexDirection: "column" }, ...rows);
}

/**
 * Multi-column list with preview panel component
 * Shows selected item details below the list
 */
export function MultiColumnListWithPreviewComponent({
    items,
    getPreviewContent,
    ctx,
    selectedIndexRef
}) {
    const [, forceUpdate] = useState({});

    // Calculate layout
    const termWidth = (process.stdout.columns || 80) - 8;
    const maxItemLength = Math.max(...items.map(w => w.length));
    const columnWidth = maxItemLength + 3;
    const columns = Math.max(1, Math.floor(termWidth / columnWidth));
    const itemsPerColumn = Math.ceil(items.length / columns);

    // Set up actions in useEffect (runs once)
    useEffect(() => {
        ctx.setAction("moveUp", () => {
            selectedIndexRef.current = Math.max(0, selectedIndexRef.current - 1);
            forceUpdate({});
        });

        ctx.setAction("moveDown", () => {
            selectedIndexRef.current = Math.min(items.length - 1, selectedIndexRef.current + 1);
            forceUpdate({});
        });

        ctx.setAction("moveLeft", () => {
            if (selectedIndexRef.current === 0) {
                ctx.goBack();
            } else {
                selectedIndexRef.current = Math.max(0, selectedIndexRef.current - itemsPerColumn);
                forceUpdate({});
            }
        });

        ctx.setAction("moveRight", () => {
            selectedIndexRef.current = Math.min(items.length - 1, selectedIndexRef.current + itemsPerColumn);
            forceUpdate({});
        });

        // Set up key bindings
        ctx.setKeyBinding([
            { key: "leftArrow", caption: "navigate", action: "moveLeft", order: 0 },
            { key: "rightArrow", caption: "navigate", action: "moveRight", order: 0 },
            { key: "upArrow", caption: "navigate", action: "moveUp", order: 0 },
            { key: "downArrow", caption: "navigate", action: "moveDown", order: 0 }
        ]);

        // Add footer
        ctx.addFooter(`Total: ${items.length} items`);
    }, []);

    const selectedIndex = selectedIndexRef.current;
    const selectedItem = items[selectedIndex];

    // Build grid
    const rows = [];
    for (let row = 0; row < itemsPerColumn; row++) {
        const cols = [];
        for (let col = 0; col < columns; col++) {
            const index = col * itemsPerColumn + row;
            if (index < items.length) {
                const isSelected = index === selectedIndex;
                cols.push(
                    h(Box, { key: index, width: columnWidth },
                        h(Text, {
                            color: isSelected ? "black" : "white",
                            backgroundColor: isSelected ? "cyan" : undefined,
                            bold: isSelected
                        }, items[index].padEnd(maxItemLength))
                    )
                );
            }
        }
        rows.push(
            h(ScreenRow, { key: row, children: h(Box, { flexDirection: "row" }, ...cols) })
        );
    }

    // Get preview content for selected item
    const previewContent = getPreviewContent ? getPreviewContent(selectedItem) : selectedItem;

    const previewRows = [];
    if (typeof previewContent === "string") {
        previewRows.push(h(ScreenRow, { key: "preview-string", children: h(Text, { bold: true }, previewContent) }));
    } else if (typeof previewContent === "object" && !React.isValidElement(previewContent) && previewContent !== null) {
        Object.entries(previewContent).forEach(([key, value], idx) => {
            previewRows.push(h(ScreenRow, { key: `preview-${key}-${idx}`, children: h(Text, {}, `${key}: ${value}`) }));
        });
    } else if (React.isValidElement(previewContent)) {
        previewRows.push(h(ScreenRow, { key: "preview-element", children: previewContent }));
    }

    return h(Box, { flexDirection: "column" },
        ...rows,
        h(ScreenRow, { key: "spacer-1", children: h(Text, {}, " ") }),
        h(ScreenDivider, { key: "divider" }),
        h(ScreenRow, { key: "spacer-2", children: h(Text, {}, " ") }),
        ...previewRows
    );
}

/**
 * Single-column list component
 * Simple vertical menu with optional sorting
 */
export function ListComponent({ items, ctx, selectedIndexRef, renderItem, getTitle, sortable = false, maxHeight, sortHighlightStyle, selectionMarker = " ", onSelectionChange }) {
    const [, forceUpdate] = useState({});
    const [sortOrder, setSortOrder] = useState("none");
    const [scrollOffset, setScrollOffset] = useState(0);
    
    // Use refs to store current scroll values to avoid stale closures
    const scrollStateRef = useRef({ scrollOffset: 0, maxHeight: 0, totalItems: 0 });
    const itemsRef = useRef(items);
    itemsRef.current = items;

    // Default getTitle - returns item if string, otherwise item.title
    const defaultGetTitle = (item) => {
        return getTitle ? getTitle(item) : (typeof item.value === "string" ? item.value : (item.value?.title || item.name));
    };

    // Get title for sorting
    const titleGetter = getTitle || defaultGetTitle;

    // Apply sorting if enabled
    const displayItems = sortable && sortOrder !== "none" ? [...items].sort((a, b) => {
        const titleA = titleGetter(a).toLowerCase();
        const titleB = titleGetter(b).toLowerCase();
        if (sortOrder === "asc") {
            return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
        } else {
            return titleA > titleB ? -1 : titleA < titleB ? 1 : 0;
        }
    }) : items;

    const displayItemsRef = useRef(displayItems);
    displayItemsRef.current = displayItems;

    // Calculate scrolling
    const effectiveMaxHeight = maxHeight || displayItems.length;
    const _canScroll = displayItems.length > effectiveMaxHeight;
    const maxScrollOffset = Math.max(0, displayItems.length - effectiveMaxHeight);
    
    // Ensure scroll offset is within bounds
    const clampedScrollOffset = Math.min(Math.max(0, scrollOffset), maxScrollOffset);
    
    // Get visible items
    const visibleItems = displayItems.slice(clampedScrollOffset, clampedScrollOffset + effectiveMaxHeight);
    
    // Check if we can scroll up/down
    const canScrollUp = clampedScrollOffset > 0;
    const canScrollDown = clampedScrollOffset < maxScrollOffset;
    
    // Update scroll state ref with current values
    scrollStateRef.current = { scrollOffset, maxHeight: effectiveMaxHeight, totalItems: displayItems.length };
    

    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    // Set up actions in useEffect (runs once)
    useEffect(() => {
        ctx.setAction("moveUp", () => {
            const newIndex = Math.max(0, selectedIndexRef.current - 1);
            selectedIndexRef.current = newIndex;
            const list = displayItemsRef.current;
            onSelectionChangeRef.current?.(newIndex, list[newIndex]);

            // Auto-scroll to keep selected item visible
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } = scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            const currentClampedScrollOffset = Math.min(Math.max(0, currentScrollOffset), currentMaxScrollOffset);

            if (newIndex < currentClampedScrollOffset) {
                setScrollOffset(newIndex);
            }

            forceUpdate({});
        });

        ctx.setAction("moveDown", () => {
            const currentItems = displayItemsRef.current;
            const maxIndex = Math.max(0, currentItems.length - 1);
            const newIndex = Math.min(maxIndex, selectedIndexRef.current + 1);
            selectedIndexRef.current = newIndex;
            onSelectionChangeRef.current?.(newIndex, currentItems[newIndex]);

            // Auto-scroll to keep selected item visible
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } = scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            const currentClampedScrollOffset = Math.min(Math.max(0, currentScrollOffset), currentMaxScrollOffset);

            if (newIndex >= currentClampedScrollOffset + currentMaxHeight) {
                setScrollOffset(newIndex - currentMaxHeight + 1);
            }

            forceUpdate({});
        });

        // Viewport scroll (without moving selection)
        ctx.setAction("scrollUp", () => {
            const { scrollOffset: currentScrollOffset } = scrollStateRef.current;
            setScrollOffset(Math.max(0, currentScrollOffset - 1));
            forceUpdate({});
        });

        ctx.setAction("scrollDown", () => {
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } =
                scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            setScrollOffset(Math.min(currentMaxScrollOffset, currentScrollOffset + 1));
            forceUpdate({});
        });

        // Page: move selection by one viewport, keep it visible (⌥/Ctrl+↑↓, PgUp/PgDn)
        ctx.setAction("pageUp", () => {
            const { maxHeight: vh } = scrollStateRef.current;
            const page = Math.max(1, vh || 1);
            const newIndex = Math.max(0, selectedIndexRef.current - page);
            selectedIndexRef.current = newIndex;
            const list = displayItemsRef.current;
            onSelectionChangeRef.current?.(newIndex, list[newIndex]);
            setScrollOffset(newIndex);
            forceUpdate({});
        });

        ctx.setAction("pageDown", () => {
            const { maxHeight: vh, totalItems } = scrollStateRef.current;
            const page = Math.max(1, vh || 1);
            const maxIndex = Math.max(0, totalItems - 1);
            const newIndex = Math.min(maxIndex, selectedIndexRef.current + page);
            selectedIndexRef.current = newIndex;
            const list = displayItemsRef.current;
            onSelectionChangeRef.current?.(newIndex, list[newIndex]);
            const maxScroll = Math.max(0, totalItems - page);
            setScrollOffset(Math.min(maxScroll, Math.max(0, newIndex - page + 1)));
            forceUpdate({});
        });

        const navBindings = [
            { key: "upArrow", caption: "navigate", action: "moveUp", order: 0 },
            { key: "downArrow", caption: "navigate", action: "moveDown", order: 0 },
            ...PAGE_SCROLL_KEY_BINDINGS,
        ];

        // Set up sort action if sortable
        if (sortable) {
            ctx.setAction("toggleSort", () => {
                const nextSort = 
                    sortOrder === "none" ? "asc" : 
                        sortOrder === "asc" ? "desc" : "none";
                
                // Store the currently selected item from the current display items
                const currentSelectedItem = displayItemsRef.current[selectedIndexRef.current];
                
                setSortOrder(nextSort);
                
                // Calculate the new sorted items
                const newSortedItems = nextSort !== "none" ? [...itemsRef.current].sort((a, b) => {
                    const titleA = titleGetter(a).toLowerCase();
                    const titleB = titleGetter(b).toLowerCase();
                    if (nextSort === "asc") {
                        return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
                    } else {
                        return titleA > titleB ? -1 : titleA < titleB ? 1 : 0;
                    }
                }) : itemsRef.current;
                
                // Find the new index of the selected item in the new sorted list
                const newIndex = newSortedItems.findIndex(item => item === currentSelectedItem);
                if (newIndex !== -1) {
                    selectedIndexRef.current = newIndex;
                    // Set scroll position to show the selected item at the top
                    setScrollOffset(newIndex);
                } else {
                    // Fallback: if item not found, select first item
                    selectedIndexRef.current = 0;
                    setScrollOffset(0);
                }
                
                forceUpdate({});
            });

            // Default highlight style (green background, black text, bold)
            const defaultHighlightStyle = {
                color: "black",
                backgroundColor: "green", 
                bold: true
            };
            const highlightStyle = { ...defaultHighlightStyle, ...sortHighlightStyle };

            ctx.setKeyBinding([
                ...navBindings,
                {
                    key: "s",
                    caption: "toggle sort",
                    action: "toggleSort",
                    order: 5,
                    kind: "toggle",
                    value: sortOrder === "none" ? undefined : sortOrder === "asc" ? "ASC" : "DESC",
                    valueStyle: highlightStyle,
                },
            ]);

            // Force update to show the new caption in footer
            ctx.update();
        } else {
            ctx.setKeyBinding(navBindings);
        }
    }, [sortOrder, sortable]);

    const selectedIndex = selectedIndexRef.current;
    const needsBar = displayItems.length > effectiveMaxHeight;
    const barGlyphs = needsBar
        ? scrollbarGlyphs(effectiveMaxHeight, displayItems.length, clampedScrollOffset)
        : null;

    const appendBar = (rowContent, displayIndex) => {
        if (!barGlyphs) return rowContent;
        const glyph = barGlyphs[displayIndex] ?? BAR_TRACK;
        return h(
            Box,
            { flexDirection: "row" },
            rowContent,
            h(Text, { color: glyph === BAR_THUMB ? "cyan" : "gray" }, glyph),
        );
    };

    // Default renderer — edge ↑/↓ only when there is no scrollbar (bar replaces them).
    const defaultRenderItem = (item, isSelected, displayIndex, actualIndex) => {
        const isFirstVisible = displayIndex === 0;
        const isLastVisible = displayIndex === visibleItems.length - 1;

        let arrowPrefix = "  ";
        if (!needsBar) {
            if (isFirstVisible && canScrollUp) arrowPrefix = "↑ ";
            else if (isLastVisible && canScrollDown) arrowPrefix = "↓ ";
        }

        const selectionPrefix = isSelected
            ? selectionMarker
            : " ".repeat(selectionMarker.length);

        const label = clipNameForScrollbar(item.name, needsBar);

        return h(
            Box,
            { flexDirection: "row" },
            h(Text, { key: `arrow-${actualIndex}`, color: "white" }, arrowPrefix),
            h(Text, { key: `marker-${actualIndex}`, color: "white" }, selectionPrefix),
            h(
                Text,
                {
                    key: `name-${actualIndex}`,
                    color: isSelected ? "black" : "white",
                    backgroundColor: isSelected ? "cyan" : undefined,
                    bold: isSelected,
                },
                label,
            ),
        );
    };

    const itemRenderer = renderItem || defaultRenderItem;

    return h(
        Box,
        { flexDirection: "column" },
        ...visibleItems.map((item, displayIndex) => {
            const actualIndex = clampedScrollOffset + displayIndex;
            const isSelected = actualIndex === selectedIndex;

            if (renderItem) {
                const isFirstVisible = displayIndex === 0;
                const isLastVisible = displayIndex === visibleItems.length - 1;

                let arrowPrefix = "  ";
                if (!needsBar) {
                    if (isFirstVisible && canScrollUp) arrowPrefix = "↑ ";
                    else if (isLastVisible && canScrollDown) arrowPrefix = "↓ ";
                }

                const selectionPrefix = isSelected
                    ? selectionMarker
                    : " ".repeat(selectionMarker.length);

                const clipped = needsBar
                    ? { ...item, name: clipNameForScrollbar(item.name, true) }
                    : item;

                const row = h(
                    Box,
                    { flexDirection: "row" },
                    h(Text, { key: `arrow-${actualIndex}`, color: "white" }, arrowPrefix),
                    h(Text, { key: `marker-${actualIndex}`, color: "white" }, selectionPrefix),
                    renderItem(clipped, isSelected, displayIndex),
                );

                return h(ScreenRow, {
                    key: `item-${actualIndex}`,
                    children: appendBar(row, displayIndex),
                });
            }

            return h(ScreenRow, {
                key: `item-${actualIndex}`,
                children: appendBar(
                    itemRenderer(item, isSelected, displayIndex, actualIndex),
                    displayIndex,
                ),
            });
        }),
    );
}
