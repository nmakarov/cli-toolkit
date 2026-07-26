/**
 * Screen System - Action-based architecture
 */

import { useState, createElement as h } from "react";
import { render, useInput, Text } from "ink";
import { ScreenContainer, ScreenRow, ScreenTitle, ScreenDivider, ScreenFooter } from "./components.js";
import { MultiColumnListComponent, MultiColumnListWithPreviewComponent, ListComponent } from "./list-components.js";
import {
    bindingIdentity,
    bindingMatchesInput,
    formatBindingKey,
} from "./key-bindings.js";

// Types
















































































/**
 * Group key bindings by caption for footer display
 */
export function groupKeyBindings(bindings) {
    const groups = {};

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
        groups[caption].keys.push(formatBindingKey(binding));
    });

    return Object.values(groups);
}

/**
 * Format key bindings for footer (returns array of strings/components)
 */
export function formatKeyBindings(bindings, mode = "long") {
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

    const items = [];

    groups.forEach(group => {
        // Check if any binding in this group has a component/custom caption
        const bindingWithCustom = resolvedBindings.find(b =>
            group.keys.includes(b.key) && typeof b.resolvedCaption !== "string"
        );

        if (bindingWithCustom && bindingWithCustom.resolvedCaption) {
            // Use the full custom display (component or complex structure)
            items.push(bindingWithCustom.resolvedCaption );
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
export function formatKeys(keys) {
    // `keys` may already be display labels (from groupKeyBindings) or raw key names.
    const keyMap = {
        escape: "esc",
        leftArrow: "←",
        rightArrow: "→",
        upArrow: "↑",
        downArrow: "↓",
        return: "enter",
        pageUp: "PgUp",
        pageDown: "PgDn",
    };

    return keys.map((k) => keyMap[k] || k).join("/");
}

/**
 * Show screen with action-based architecture
 */
export async function showScreen(config) {
    const {
        title,
        onRender,
        parentData = {}
    } = config;


    return new Promise((resolve) => {
        // eslint-disable-next-line prefer-const
        let instance;

        // Persistent collections (closure variables survive re-renders)
        const keyBindings = [];
        const actions = {};
        const customFooterItems = [];
        let renderResult = null;
        let initialized = false;

        const Screen = () => {
            const [, setUpdateCounter] = useState(0);

            // Initialize defaults only once
            if (!initialized) {
                const defaultBindings = [
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
            const context = {
                setAction: (actionName, handlerFn) => {
                    actions[actionName] = handlerFn;
                },

                setKeyBinding: (bindingOrBindings) => {
                    // Support both single object and array
                    const bindingsToSet = Array.isArray(bindingOrBindings) ? bindingOrBindings : [bindingOrBindings];

                    bindingsToSet.forEach(binding => {
                        const id = bindingIdentity(binding);
                        const existingIndex = keyBindings.findIndex(
                            (b) => bindingIdentity(b) === id,
                        );

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

                updateKeyBinding: (keyName, updates) => {
                    // Prefer identity match when updates carry modifiers; else first key name.
                    const id =
                        updates && (updates.meta != null || updates.ctrl != null || updates.shift != null)
                            ? bindingIdentity({ key: keyName, ...updates })
                            : null;
                    const index = keyBindings.findIndex((b) =>
                        id ? bindingIdentity(b) === id : b.key === keyName,
                    );
                    if (index >= 0) {
                        // Update only specified properties
                        keyBindings[index] = {
                            ...keyBindings[index],
                            ...updates
                        };
                    }
                },

                removeKeyBinding: (keyNameOrBinding) => {
                    const index =
                        typeof keyNameOrBinding === "object" && keyNameOrBinding
                            ? keyBindings.findIndex(
                                  (b) => bindingIdentity(b) === bindingIdentity(keyNameOrBinding),
                              )
                            : keyBindings.findIndex((b) => b.key === keyNameOrBinding);
                    if (index >= 0) {
                        if (keyBindings[index].protected) {
                            console.warn(`Cannot remove protected key: ${keyNameOrBinding}`);
                            return;
                        }
                        keyBindings.splice(index, 1);
                    }
                },

                addFooter: (item) => {
                    customFooterItems.push(item);
                },

                clearFooter: () => {
                    customFooterItems.length = 0;
                },

                setFooter: (items) => {
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

                close: (result) => {
                    cleanup(result);
                },

                parentData
            };

            // Call onRender once to let component set up
            if (!renderResult) {
                renderResult = onRender(context);
            }

            // Handle input - dispatch to actions
            useInput((input, key) => {
                // Check Ctrl+C for exit
                if (key.ctrl && input === "c") {
                    cleanup(null);
                    process.exit(0);
                    return;
                }

                // Find matching key binding
                let matchedBinding = null;

                for (const binding of keyBindings) {
                    if (binding.enabled === false) continue;
                    if (!bindingMatchesInput(binding, input, key)) continue;
                    if (binding.condition && !binding.condition(context)) continue;

                    matchedBinding = binding;
                    break;
                }

                if (matchedBinding && actions[matchedBinding.action]) {
                    // Execute action
                    actions[matchedBinding.action]({
                        input,
                        key,
                        binding: matchedBinding
                    });

                    // If action returns a value, might be used for something
                    // For now, actions manage their own state via closures
                }
            });

            // Build footer
            const footerLines = [];

            // Add key bindings (returns array of strings/components)
            const bindingItems = formatKeyBindings(keyBindings, "long");

            if (bindingItems.length > 0) {
                // Build a single line with all binding items separated by ", "
                const bindingsLine = [];
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

        const cleanup = (result) => {
            if (instance) instance.unmount();
            setTimeout(() => resolve(result), 50);
        };

        instance = render(h(Screen));
    });
}

/**
 * Helper: Show list screen (single column menu)
 */
export async function showListScreen(config) {
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
export async function showMultiColumnListScreen(config) {
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
export async function showMultiColumnListWithPreviewScreen(config) {
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
