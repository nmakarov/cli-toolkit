/**
 * Screen System - Action-based architecture
 * Converted from legacy/screenSystem/src
 */

// Re-export React and React hooks (encapsulated)
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo, createElement } from "react";
export { React, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo };
export { createElement as h };

// Re-export Ink components (encapsulated)
export { Box, Text, useInput } from "ink";

// Screen functions
export {
    showScreen,
    showListScreen,
    showMultiColumnListScreen,
    showMultiColumnListWithPreviewScreen,
    // Backward compatibility aliases
    showMenuScreen,
    showWordGridScreen
} from "./screens.js";

// Reusable components
export { MultiColumnListComponent, MultiColumnListWithPreviewComponent, ListComponent } from "./list-components.js";
export { ScreenContainer, ScreenRow, ScreenTitle, ScreenBody, ScreenFooter, ScreenDivider } from "./components.js";
export { ListItem, TextBlock, Divider, GridCell, InputField } from "./ui-elements.js";
export { ScrollableText, wrapTextLines, scrollbarGlyphs } from "./scrollable-text.js";
export {
    bindingIdentity,
    bindingMatchesInput,
    formatBindingKey,
} from "./key-bindings.js";

// Utilities
export { buildBreadcrumb, buildDetailBreadcrumb } from "./utils.js";
export { buildFooter, FooterPresets, organizeFooterMessages } from "./footer-builder.js";

// For CommonJS compatibility: pre-load ESM dependencies
let loadPromise = null;
export async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
        import("react"),
        import("ink")
    ]).then(() => {}) ;
    return loadPromise;
}
// Auto-load in ESM, but CJS users should call load() explicitly
if (typeof window === "undefined") {
    load().catch(() => {
    // Ignore errors during auto-load, user can call load() explicitly
    });
}
