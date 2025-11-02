/**
 * Screen System - Action-based architecture
 */

import React, { useState, useRef, useEffect, createElement as h } from "react";
import { render, useInput, Box, Text } from "ink";
import { ScreenContainer, ScreenRow, ScreenTitle, ScreenDivider, ScreenFooter } from "./components.js";
import { MultiColumnListComponent, MultiColumnListWithPreviewComponent, ListComponent } from "./list-components.js";

// Types
interface KeyBinding {
    key: string;
    caption: string | (() => string | JSX.Element);
    action: string;
    order?: number;
    protected?: boolean;
    enabled?: boolean;
    condition?: (ctx: ScreenContext) => boolean;
}

interface BindingGroup {
    keys: string[];
    caption: string;
    order: number;
}

interface ActionPayload {
    input: string;
    key: any;
    binding: KeyBinding;
}

interface ScreenContext {
    setAction: (actionName: string, handlerFn: (payload?: ActionPayload) => void | any) => void;
    setKeyBinding: (bindingOrBindings: KeyBinding | KeyBinding[]) => void;
    updateKeyBinding: (keyName: string, updates: Partial<KeyBinding>) => void;
    removeKeyBinding: (keyName: string) => void;
    addFooter: (item: string | JSX.Element) => void;
    clearFooter: () => void;
    setFooter: (items: string | string[] | JSX.Element | JSX.Element[]) => void;
    update: () => void;
    goBack: () => void;
    close: (result: any) => void;
    parentData: any;
}

interface ShowScreenConfig {
    title: string;
    onRender: (ctx: ScreenContext) => JSX.Element;
    parentData?: any;
}

interface ShowListScreenConfig {
    title: string;
    items: Array<{ name: string; value: any }>;
    onSelect?: (value: any, index: number) => any;
    onEscape?: (index: number) => any;
    parentData?: any;
    initialSelectedIndex?: number;
    renderItem?: (item: { name: string; value: any }, isSelected: boolean, displayIndex: number) => JSX.Element;
    getTitle?: (item: { name: string; value: any }) => string;
    sortable?: boolean;
    maxHeight?: number;
    sortHighlightStyle?: {
        color?: string;
        backgroundColor?: string;
        bold?: boolean;
    };
    selectionMarker?: string; // Customizable selection marker, default: " "
}

interface ShowMultiColumnListScreenConfig {
    title: string;
    items: string[];
    onSelect?: (item: string, index: number) => any;
    onEscape?: (index: number) => any;
    parentData?: any;
    initialSelectedIndex?: number;
}

interface ShowMultiColumnListWithPreviewScreenConfig {
    title: string;
    items: string[];
    getPreviewContent?: (item: string) => string | JSX.Element | Record<string, any>;
    onSelect?: (item: string, index: number) => any;
    onEscape?: (index: number) => any;
    parentData?: any;
    initialSelectedIndex?: number;
}

/**
 * Group key bindings by caption for footer display
 */
export function groupKeyBindings(bindings: KeyBinding[]): BindingGroup[] {
    const groups: Record<string, BindingGroup> = {};

    // Filter out disabled bindings
    const enabledBindings = bindings.filter(b => b.enabled !== false);

    enabledBindings.forEach(binding => {
        const caption = typeof binding.caption === "string" ? binding.caption : "";
        if (!groups[caption]) {
            groups[caption] = {
                keys: [],
                caption: caption,
                order: binding.order || 999
            };
        }
        groups[caption].keys.push(binding.key);
    });

    return Object.values(groups);
}

/**
 * Format key bindings for footer (returns array of strings/components)
 */
export function formatKeyBindings(bindings: KeyBinding[], mode: string = "long"): (string | JSX.Element)[] {
    // Resolve function captions
    const resolvedBindings = bindings.map(binding => {
        let resolvedCaption = binding.caption;

        // If caption is a function, call it
        if (typeof binding.caption === "function") {
            resolvedCaption = binding.caption();
        }

        return {
            ...binding,
            resolvedCaption
        };
    });

    const groups = groupKeyBindings(resolvedBindings.map(b => ({
        ...b,
        caption: typeof b.resolvedCaption === "string" ? b.resolvedCaption : ""
    })));

    // Sort by order
    groups.sort((a, b) => a.order - b.order);

    const items: (string | JSX.Element)[] = [];

    groups.forEach(group => {
        // Check if any binding in this group has a component/custom caption
        const bindingWithCustom = resolvedBindings.find(b =>
            group.keys.includes(b.key) && typeof b.resolvedCaption !== "string"
        );

        if (bindingWithCustom && bindingWithCustom.resolvedCaption) {
            // Use the full custom display (component or complex structure)
            items.push(bindingWithCustom.resolvedCaption as JSX.Element);
        } else {
            // Standard format with string caption
            const keyStr = formatKeys(group.keys);

            if (mode === "long") {
                items.push(`${keyStr} to ${group.caption}`);
            } else {
                items.push(keyStr);
            }
        }
    });

    return items;
}

/**
 * Format keys for display
 */
export function formatKeys(keys: string[]): string {
    const keyMap: Record<string, string> = {
        "escape": "esc",
        "leftArrow": "←",
        "rightArrow": "→",
        "upArrow": "↑",
        "downArrow": "↓",
        "return": "enter"
    };

    return keys.map(k => keyMap[k] || k).join("/");
}

/**
 * Show screen with action-based architecture
 */
export async function showScreen(config: ShowScreenConfig): Promise<any> {
    const {
        title,
        onRender,
        parentData = {}
    } = config;


    return new Promise((resolve) => {
        let instance: any;

        // Persistent collections (closure variables survive re-renders)
        const keyBindings: KeyBinding[] = [];
        const actions: Record<string, (payload?: ActionPayload) => void | any> = {};
        const customFooterItems: (string | JSX.Element)[] = [];
        let renderResult: JSX.Element | null = null;
        let initialized = false;

        const Screen = (): JSX.Element => {
            const [updateCounter, setUpdateCounter] = useState(0);

            // Initialize defaults only once
            if (!initialized) {
                const defaultBindings: KeyBinding[] = [
                    { key: "escape", caption: "go back", action: "back", protected: true, order: 1 },
                    { key: "leftArrow", caption: "go back", action: "back", protected: false, order: 1 }
                    // Note: 'select' is not a default - components add it if needed
                ];

                // Add defaults
                defaultBindings.forEach(binding => {
                    keyBindings.push(binding);
                });

                // Default actions
                actions.back = () => {
                    cleanup(null);
                };

                initialized = true;
            }

            // Context for onRender
            const context: ScreenContext = {
                setAction: (actionName: string, handlerFn: (payload?: ActionPayload) => void | any) => {
                    actions[actionName] = handlerFn;
                },

                setKeyBinding: (bindingOrBindings: KeyBinding | KeyBinding[]) => {
                    // Support both single object and array
                    const bindingsToSet = Array.isArray(bindingOrBindings) ? bindingOrBindings : [bindingOrBindings];

                    bindingsToSet.forEach(binding => {
                        // Check if key already exists
                        const existingIndex = keyBindings.findIndex(b => b.key === binding.key);

                        if (existingIndex >= 0) {
                            const existing = keyBindings[existingIndex];

                            // Can't override protected keys
                            if (existing.protected) {
                                console.warn(`Cannot override protected key: ${binding.key}`);
                                return;
                            }

                            // Replace binding (keep original order if not specified)
                            keyBindings[existingIndex] = {
                                ...existing,
                                ...binding,
                                order: binding.order !== undefined ? binding.order : existing.order,
                                enabled: binding.enabled !== undefined ? binding.enabled : (existing.enabled !== undefined ? existing.enabled : true)
                            };
                        } else {
                            // Add new binding
                            keyBindings.push({
                                protected: false,
                                order: 999,
                                enabled: true,
                                ...binding
                            });
                        }
                    });
                },

                updateKeyBinding: (keyName: string, updates: Partial<KeyBinding>) => {
                    const index = keyBindings.findIndex(b => b.key === keyName);
                    if (index >= 0) {
                        // Update only specified properties
                        keyBindings[index] = {
                            ...keyBindings[index],
                            ...updates
                        };
                    }
                },

                removeKeyBinding: (keyName: string) => {
                    const index = keyBindings.findIndex(b => b.key === keyName);
                    if (index >= 0) {
                        if (keyBindings[index].protected) {
                            console.warn(`Cannot remove protected key: ${keyName}`);
                            return;
                        }
                        keyBindings.splice(index, 1);
                    }
                },

                addFooter: (item: string | JSX.Element) => {
                    customFooterItems.push(item);
                },

                clearFooter: () => {
                    customFooterItems.length = 0;
                },

                setFooter: (items: string | string[] | JSX.Element | JSX.Element[]) => {
                    customFooterItems.length = 0;
                    const itemsArray = Array.isArray(items) ? items : [items];
                    customFooterItems.push(...itemsArray);
                },

                update: () => {
                    setUpdateCounter(c => c + 1);
                },

                goBack: () => {
                    if (actions.back) {
                        actions.back();
                    }
                },

                close: (result: any) => {
                    cleanup(result);
                },

                parentData
            };

            // Call onRender once to let component set up
            if (!renderResult) {
                renderResult = onRender(context);
            }

            // Handle input - dispatch to actions
            useInput((input: string, key: any) => {
                // Check Ctrl+C for exit
                if (key.ctrl && input === "c") {
                    cleanup(null);
                    process.exit(0);
                    return;
                }

                // Find matching key binding
                let matchedBinding: KeyBinding | null = null;

                for (const binding of keyBindings) {
                    let keyMatches = false;

                    // Check key match
                    if (key[binding.key]) {
                        keyMatches = true;
                    } else if (input === binding.key) {
                        keyMatches = true;
                    }

                    if (keyMatches) {
                        // Check if binding is enabled
                        if (binding.enabled === false) {
                            continue;
                        }

                        // Check condition if present
                        if (binding.condition && !binding.condition(context)) {
                            continue;
                        }

                        matchedBinding = binding;
                        break;
                    }
                }

                if (matchedBinding && actions[matchedBinding.action]) {
                    // Execute action
                    const actionResult = actions[matchedBinding.action]({
                        input,
                        key,
                        binding: matchedBinding
                    });

                    // If action returns a value, might be used for something
                    // For now, actions manage their own state via closures
                }
            });

            // Build footer
            const footerLines: (string | JSX.Element | (string | JSX.Element)[])[] = [];

            // Add key bindings (returns array of strings/components)
            const bindingItems = formatKeyBindings(keyBindings, "long");

            if (bindingItems.length > 0) {
                // Build a single line with all binding items separated by ", "
                const bindingsLine: (string | JSX.Element)[] = [];
                bindingItems.forEach((item, idx) => {
                    if (idx > 0) {
                        bindingsLine.push(", ");
                    }
                    bindingsLine.push(item);
                });

                // If all items are strings, join them; otherwise create a Box
                const allStrings = bindingItems.every(item => typeof item === "string");
                if (allStrings) {
                    footerLines.push(bindingsLine.join(""));
                } else {
                    // Mixed strings and components - wrap all strings in Text components
                    const wrappedBindingsLine = bindingsLine.map(item => 
                        typeof item === "string" ? h(Text, {}, item) : item
                    );
                    footerLines.push(wrappedBindingsLine);
                }
            }

            // Add custom footer items
            customFooterItems.forEach(item => {
                if (typeof item === "string") {
                    footerLines.push(item);
                } else {
                    footerLines.push(item);
                }
            });

            return h(ScreenContainer, {},
                h(ScreenTitle, { text: title }),
                h(ScreenDivider),
                h(ScreenRow, {}, h(Text, {}, " ")),
                renderResult,
                h(ScreenRow, {}, h(Text, {}, " ")),
                h(ScreenDivider),
                h(ScreenFooter, { lines: footerLines })
            );
        };

        const cleanup = (result: any) => {
            if (instance) instance.unmount();
            setTimeout(() => resolve(result), 50);
        };

        instance = render(h(Screen));
    });
}

/**
 * Helper: Show list screen (single column menu)
 */
export async function showListScreen(config: ShowListScreenConfig): Promise<any> {
    const { title, items, onSelect, onEscape, parentData, initialSelectedIndex = 0, renderItem, getTitle, sortable, maxHeight, sortHighlightStyle, selectionMarker } = config;

    return showScreen({
        title,
        parentData,
        onRender: (ctx) => {
            // Shared state ref
            const selectedIndexRef = { current: initialSelectedIndex };

            // Set up select action at screen level
            ctx.setAction("select", () => {
                const selected = items[selectedIndexRef.current];
                if (onSelect) {
                    const result = onSelect(selected.value, selectedIndexRef.current);
                    ctx.close(result);
                }
            });

            // Set up back action if provided
            if (onEscape) {
                ctx.setAction("back", () => {
                    const result = onEscape(selectedIndexRef.current);
                    ctx.close(result);
                });
            }

            // Add select key binding
            ctx.setKeyBinding({ key: "return", caption: "select", action: "select", order: 2 });

            // Return the component (it will set up its own navigation actions and bindings)
            return h(ListComponent, { items, ctx, selectedIndexRef, renderItem, getTitle, sortable, maxHeight, sortHighlightStyle, selectionMarker });
        }
    });
}

/**
 * Helper: Show multi-column list screen (grid layout)
 */
export async function showMultiColumnListScreen(config: ShowMultiColumnListScreenConfig): Promise<any> {
    const { title, items, onSelect, onEscape, parentData, initialSelectedIndex = 0 } = config;

    return showScreen({
        title,
        parentData,
        onRender: (ctx) => {
            // Shared state ref
            const selectedIndexRef = { current: initialSelectedIndex };

            // Set up select action at screen level
            ctx.setAction("select", () => {
                const selected = items[selectedIndexRef.current];
                if (onSelect) {
                    const result = onSelect(selected, selectedIndexRef.current);
                    ctx.close(result);
                }
            });

            // Set up back action if provided
            if (onEscape) {
                ctx.setAction("back", () => {
                    const result = onEscape(selectedIndexRef.current);
                    ctx.close(result);
                });
            }

            // Add select key binding
            ctx.setKeyBinding({ key: "return", caption: "select", action: "select", order: 2 });

            // Return the component (it will set up its own navigation actions and bindings)
            return h(MultiColumnListComponent, { items, ctx, selectedIndexRef });
        }
    });
}

/**
 * Helper: Show multi-column list with preview panel below
 */
export async function showMultiColumnListWithPreviewScreen(config: ShowMultiColumnListWithPreviewScreenConfig): Promise<any> {
    const { title, items, getPreviewContent, onSelect, onEscape, parentData, initialSelectedIndex = 0 } = config;

    return showScreen({
        title,
        parentData,
        onRender: (ctx) => {
            // Shared state ref
            const selectedIndexRef = { current: initialSelectedIndex };

            // Set up select action at screen level
            ctx.setAction("select", () => {
                const selected = items[selectedIndexRef.current];
                if (onSelect) {
                    const result = onSelect(selected, selectedIndexRef.current);
                    ctx.close(result);
                }
            });

            // Set up back action if provided
            if (onEscape) {
                ctx.setAction("back", () => {
                    const result = onEscape(selectedIndexRef.current);
                    ctx.close(result);
                });
            }

            // Add select key binding
            ctx.setKeyBinding({ key: "return", caption: "select", action: "select", order: 2 });

            // Return the component (it will set up its own navigation actions and bindings)
            return h(MultiColumnListWithPreviewComponent, { items, getPreviewContent, ctx, selectedIndexRef });
        }
    });
}

// Backward compatibility aliases
export const showMenuScreen = showListScreen;
export const showWordGridScreen = showMultiColumnListScreen;
