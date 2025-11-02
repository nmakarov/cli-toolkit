/**
 * Reusable screen components for V2 architecture
 */

import React, { useState, useEffect, useRef, createElement } from "react";
import { Box, Text } from "ink";
import { ScreenRow, ScreenDivider } from "./components.js";

const h = createElement;

// TODO: Define proper context type interface
interface ScreenContext {
    setAction: (name: string, handler: () => void) => void;
    setKeyBinding: (bindings: KeyBinding | KeyBinding[]) => void;
    addFooter: (message: string) => void;
    setFooter: (items: string | string[]) => void;
    goBack: () => void;
    update: () => void;
}

interface KeyBinding {
    key: string;
    caption: string;
    action: string;
    order: number;
}

interface ListItem {
    name: string;
    value: any;
}

interface MultiColumnListComponentProps {
    items: string[];
    ctx: ScreenContext;
    selectedIndexRef: { current: number };
}

interface MultiColumnListWithPreviewComponentProps {
    items: string[];
    getPreviewContent?: (item: string) => string | JSX.Element | Record<string, any>;
    ctx: ScreenContext;
    selectedIndexRef: { current: number };
}

interface ListComponentProps {
    items: ListItem[];
    ctx: ScreenContext;
    selectedIndexRef: { current: number };
    renderItem?: (item: ListItem, isSelected: boolean, displayIndex: number) => JSX.Element;
    getTitle?: (item: ListItem) => string;
    sortable?: boolean;
    maxHeight?: number;
    sortHighlightStyle?: {
        color?: string;
        backgroundColor?: string;
        bold?: boolean;
    };
    selectionMarker?: string; // Customizable selection marker, default: " "
}

/**
 * Multi-column list component
 * Handles its own navigation, actions, and key bindings
 */
export function MultiColumnListComponent({ items, ctx, selectedIndexRef }: MultiColumnListComponentProps): JSX.Element {
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
    const rows: JSX.Element[] = [];
    for (let row = 0; row < itemsPerColumn; row++) {
        const cols: JSX.Element[] = [];
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
}: MultiColumnListWithPreviewComponentProps): JSX.Element {
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
    const rows: JSX.Element[] = [];
    for (let row = 0; row < itemsPerColumn; row++) {
        const cols: JSX.Element[] = [];
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

    const previewRows: JSX.Element[] = [];
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
export function ListComponent({ items, ctx, selectedIndexRef, renderItem, getTitle, sortable = false, maxHeight, sortHighlightStyle, selectionMarker = " " }: ListComponentProps): JSX.Element {
    const [, forceUpdate] = useState({});
    const [sortOrder, setSortOrder] = useState<"none" | "asc" | "desc">("none");
    const [scrollOffset, setScrollOffset] = useState(0);
    
    // Use refs to store current scroll values to avoid stale closures
    const scrollStateRef = useRef({ scrollOffset: 0, maxHeight: 0, totalItems: 0 });

    // Default getTitle - returns item if string, otherwise item.title
    const defaultGetTitle = (item: ListItem): string => {
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

    // Calculate scrolling
    const effectiveMaxHeight = maxHeight || displayItems.length;
    const canScroll = displayItems.length > effectiveMaxHeight;
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
    

    // Set up actions in useEffect (runs once)
    useEffect(() => {
        ctx.setAction("moveUp", () => {
            const newIndex = Math.max(0, selectedIndexRef.current - 1);
            selectedIndexRef.current = newIndex;
            
            // Auto-scroll to keep selected item visible
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } = scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            const currentClampedScrollOffset = Math.min(Math.max(0, currentScrollOffset), currentMaxScrollOffset);
            
            if (newIndex < currentClampedScrollOffset) {
                setScrollOffset(newIndex);
            }
            
            // Force update to trigger re-render with new selected index
            forceUpdate({});
        });

        ctx.setAction("moveDown", () => {
            const currentItems = sortable && sortOrder !== "none" ? [...items].sort((a, b) => {
                const titleA = titleGetter(a).toLowerCase();
                const titleB = titleGetter(b).toLowerCase();
                if (sortOrder === "asc") {
                    return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
                } else {
                    return titleA > titleB ? -1 : titleA < titleB ? 1 : 0;
                }
            }) : items;
            
            const maxIndex = currentItems.length - 1;
            const newIndex = Math.min(maxIndex, selectedIndexRef.current + 1);
            selectedIndexRef.current = newIndex;
            
            // Auto-scroll to keep selected item visible
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } = scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            const currentClampedScrollOffset = Math.min(Math.max(0, currentScrollOffset), currentMaxScrollOffset);
            
            if (newIndex >= currentClampedScrollOffset + currentMaxHeight) {
                setScrollOffset(newIndex - currentMaxHeight + 1);
            }
            
            // Force update to trigger re-render with new selected index
            forceUpdate({});
        });

        // Add scroll actions for arrow clicks
        ctx.setAction("scrollUp", () => {
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } = scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            const newScrollOffset = Math.max(0, currentScrollOffset - 1);
            setScrollOffset(newScrollOffset);
            forceUpdate({});
        });

        ctx.setAction("scrollDown", () => {
            const { scrollOffset: currentScrollOffset, maxHeight: currentMaxHeight, totalItems } = scrollStateRef.current;
            const currentMaxScrollOffset = Math.max(0, totalItems - currentMaxHeight);
            const newScrollOffset = Math.min(currentMaxScrollOffset, currentScrollOffset + 1);
            setScrollOffset(newScrollOffset);
            forceUpdate({});
        });

        // Set up sort action if sortable
        if (sortable) {
            ctx.setAction("toggleSort", () => {
                const nextSort: "none" | "asc" | "desc" = 
                    sortOrder === "none" ? "asc" : 
                    sortOrder === "asc" ? "desc" : "none";
                
                // Store the currently selected item from the current display items
                const currentSelectedItem = displayItems[selectedIndexRef.current];
                
                setSortOrder(nextSort);
                
                // Calculate the new sorted items
                const newSortedItems = nextSort !== "none" ? [...items].sort((a, b) => {
                    const titleA = titleGetter(a).toLowerCase();
                    const titleB = titleGetter(b).toLowerCase();
                    if (nextSort === "asc") {
                        return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
                    } else {
                        return titleA > titleB ? -1 : titleA < titleB ? 1 : 0;
                    }
                }) : items;
                
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

            // Create caption that includes sort status
            const sortCaption = () => {
                if (sortOrder === "none") {
                    return h(Text, {}, "s to toggle sort");
                } else {
                    const sortLabel = sortOrder === "asc" ? "ASC" : "DESC";
                    return h(Text, {}, 
                        "s to toggle ",
                        h(Text, { color: "white", bold: true }, "sort"),
                        " ",
                        h(Text, highlightStyle, ` ${sortLabel} `)
                    );
                }
            };

            // Update key bindings with sort
            ctx.setKeyBinding([
                { key: "upArrow", caption: "navigate", action: "moveUp", order: 0 },
                { key: "downArrow", caption: "navigate", action: "moveDown", order: 0 },
                { 
                    key: "s", 
                    caption: sortCaption,
                    action: "toggleSort", 
                    order: 5 
                }
            ]);

            // Force update to show the new caption in footer
            ctx.update();
        } else {
            // No sorting
            ctx.setKeyBinding([
                { key: "upArrow", caption: "navigate", action: "moveUp", order: 0 },
                { key: "downArrow", caption: "navigate", action: "moveDown", order: 0 }
            ]);
        }
    }, [sortOrder, sortable]);

    const selectedIndex = selectedIndexRef.current;
    

    // Default renderer with static scroll indicators for debugging
    const defaultRenderItem = (item: ListItem, isSelected: boolean, displayIndex: number, actualIndex: number) => {
        const isFirstVisible = displayIndex === 0;
        const isLastVisible = displayIndex === visibleItems.length - 1;
        
        // Build prefix with arrows and selection marker
        let arrowPrefix = "";
        let selectionPrefix = "";
        
        // Only show arrows when scrolling is actually needed and available
        if (isFirstVisible && canScrollUp) {
            arrowPrefix = "↑ ";
        } else if (isLastVisible && canScrollDown) {
            arrowPrefix = "↓ ";
        } else {
            // No arrow, but reserve the same space
            arrowPrefix = "  ";
        }
        
        // Always reserve space for selection marker (pad with spaces if not selected)
        if (isSelected) {
            selectionPrefix = selectionMarker;
        } else {
            // Pad with spaces to match the length of the selection marker
            selectionPrefix = " ".repeat(selectionMarker.length);
        }
        
        return h(Box, { flexDirection: "row" },
            // Arrow (clickable if functional, not highlighted)
            h(Text, { 
                key: `arrow-${actualIndex}`,
                color: "white"
            }, arrowPrefix),
            // Selection marker space (always same width, not highlighted) 
            h(Text, { key: `marker-${actualIndex}`, color: "white" }, selectionPrefix),
            // Item name (highlighted if selected)
            h(Text, {
                key: `name-${actualIndex}`,
                color: isSelected ? "black" : "white",
                backgroundColor: isSelected ? "cyan" : undefined,
                bold: isSelected
            }, item.name)
        );
    };

    // Use custom renderer if provided, otherwise use default
    const itemRenderer = renderItem || defaultRenderItem;

    // Render visible menu items with scroll indicators
    return h(Box, { flexDirection: "column" },
        ...visibleItems.map((item, displayIndex) => {
            const actualIndex = clampedScrollOffset + displayIndex;
            const isSelected = actualIndex === selectedIndex;
            
            // If using custom renderer, wrap it with scroll indicators
            if (renderItem) {
                const isFirstVisible = displayIndex === 0;
                const isLastVisible = displayIndex === visibleItems.length - 1;
                
                // Build prefix with arrows and selection marker
                let arrowPrefix = "";
                let selectionPrefix = "";
                
                // Only show arrows when scrolling is actually needed and available
                if (isFirstVisible && canScrollUp) {
                    arrowPrefix = "↑ ";
                } else if (isLastVisible && canScrollDown) {
                    arrowPrefix = "↓ ";
                } else {
                    // No arrow, but reserve the same space
                    arrowPrefix = "  ";
                }
                
                // Always reserve space for selection marker (pad with spaces if not selected)
                if (isSelected) {
                    selectionPrefix = selectionMarker;
                } else {
                    // Pad with spaces to match the length of the selection marker
                    selectionPrefix = " ".repeat(selectionMarker.length);
                }
                
                return h(ScreenRow, {
                    key: `item-${actualIndex}`,
                    children: h(Box, { flexDirection: "row" },
                        // Arrow (clickable if functional, not highlighted)
                        h(Text, { 
                            key: `arrow-${actualIndex}`,
                            color: "white"
                        }, arrowPrefix),
                        // Selection marker space (always same width, not highlighted) 
                        h(Text, { key: `marker-${actualIndex}`, color: "white" }, selectionPrefix),
                        // Custom rendered content
                        renderItem(item, isSelected, displayIndex)
                    )
                });
            } else {
                // Use default renderer (which already includes scroll indicators)
                return h(ScreenRow, {
                    key: `item-${actualIndex}`,
                    children: itemRenderer(item, isSelected, displayIndex, actualIndex)
                });
            }
        })
    );
}
