/**
 * Screen System - Action-based architecture
 */

import { useState, createElement as h } from "react";
import { render, useInput, Box, Text } from "ink";
import chalk from "chalk";
import { ScreenContainer, ScreenRow, ScreenTitle, ScreenDivider, ScreenFooter, normalizeFooterHotkey } from "./components.js";
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
        if (binding.kind) groups[caption].kind = binding.kind;
        if (binding.value !== undefined) groups[caption].value = binding.value;
        if (binding.valueStyle) groups[caption].valueStyle = binding.valueStyle;
    });

    return Object.values(groups);
}

/**
 * Turn key bindings into `{ hotkey, caption }` items for ScreenFooter.
 * Does not style anything — ScreenFooter paints each hotkey.
 *
 * @param {object[]} bindings
 * @param {"long"|"short"} [mode]
 */
export function bindingsToFooterHotkeys(bindings, mode = "long") {
    const customItems = [];
    const stringBindings = [];

    (bindings || []).forEach((binding) => {
        if (binding.enabled === false) return;
        let caption = binding.caption;
        if (typeof caption === "function") {
            caption = caption();
        }
        if (caption != null && typeof caption !== "string") {
            customItems.push({
                hotkey: [formatBindingKey(binding)],
                caption: "",
                node: caption,
                order: binding.order || 999,
                kind: binding.kind,
                value: binding.value,
                valueStyle: binding.valueStyle,
            });
            return;
        }
        stringBindings.push({ ...binding, caption: caption || "" });
    });

    const groups = groupKeyBindings(stringBindings);
    groups.sort((a, b) => a.order - b.order);

    const items = groups.map((group) => {
        const item = {
            hotkey: group.keys,
            caption: mode === "short" ? "" : group.caption,
            order: group.order,
        };
        if (group.kind) item.kind = group.kind;
        if (group.value !== undefined) item.value = group.value;
        if (group.valueStyle) item.valueStyle = group.valueStyle;
        return item;
    });

    customItems.forEach((item) => items.push(item));
    items.sort((a, b) => (a.order || 999) - (b.order || 999));
    return items;
}

/** @deprecated Use bindingsToFooterHotkeys — returns structured footer items. */
export function formatKeyBindings(bindings, mode = "long") {
    return bindingsToFooterHotkeys(bindings, mode);
}

export { FOOTER_HOTKEY_STYLE, FOOTER_MUTED_STYLE, normalizeFooterHotkey } from "./components.js";

/** Bold default-fg key; `reset` clears a prior dim so later keys stay bright. */
export function styleFooterHotkey(label) {
    return chalk.reset.bold(String(label));
}

/** Dim caption / separator; `reset` clears bold from the preceding key. */
export function styleFooterMuted(text) {
    return chalk.reset.dim(String(text));
}

/**
 * One footer binding: highlighted keys, dim "to …" caption.
 * Returns a chalk string (not Ink nodes) so every key is independently bright.
 * @param {string} keyStr
 * @param {string} [caption]
 * @param {"long"|"short"} [mode]
 */
export function formatFooterHotkey(keyStr, caption = "", mode = "long") {
    const keys = String(keyStr)
        .split("/")
        .map((part) => styleFooterHotkey(part))
        .join(styleFooterMuted("/"));
    if (mode === "long" && caption) {
        return keys + styleFooterMuted(` to ${caption}`);
    }
    return keys;
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
        let smartFooterHotkeys = null;
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

                /**
                 * Structured hotkey footer. With no args, rebuild from current
                 * key bindings. With an array, use those `{ hotkey, caption }`
                 * items (and optional `kind: "toggle", value`) instead.
                 */
                setSmartFooter: (items) => {
                    if (items == null) {
                        smartFooterHotkeys = null;
                    } else {
                        const arr = Array.isArray(items) ? items : [items];
                        smartFooterHotkeys = arr.map(normalizeFooterHotkey).filter(Boolean);
                    }
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

            const footerHotkeys = smartFooterHotkeys
                ?? bindingsToFooterHotkeys(keyBindings, "long");

            return h(ScreenContainer, {},
                h(ScreenTitle, { text: title }),
                h(ScreenDivider),
                h(ScreenRow, {}, h(Text, {}, " ")),
                renderResult,
                h(ScreenRow, {}, h(Text, {}, " ")),
                h(ScreenDivider),
                h(ScreenFooter, {
                    hotkeys: footerHotkeys,
                    lines: customFooterItems,
                })
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
