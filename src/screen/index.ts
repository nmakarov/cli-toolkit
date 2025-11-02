/**
 * Screen System - Action-based architecture
 * Converted from legacy/screenSystem/src
 */

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

// Utilities
export { buildBreadcrumb, buildDetailBreadcrumb } from "./utils.js";
export { buildFooter, FooterPresets, organizeFooterMessages } from "./footer-builder.js";
