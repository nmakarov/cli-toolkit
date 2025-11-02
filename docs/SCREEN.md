# Screen Module Documentation

The Screen module provides a powerful framework for building interactive terminal user interfaces using React and Ink.

## Installation

```bash
npm install @nmakarov/cli-toolkit ink react
```

**Note**: `ink` and `react` are peer dependencies and must be installed separately.

## Basic Usage

```typescript
import { showScreen, showListScreen } from '@nmakarov/cli-toolkit/screen';
import { createElement as h } from 'react';
import { Text, Box } from 'ink';

// Simple screen
await showScreen({
    title: "Welcome",
    onRender: (ctx) => {
        return h(Text, { color: "green" }, "Hello, World!");
    }
});

// Interactive list
const choice = await showListScreen({
    title: "Main Menu",
    items: [
        { name: "Option 1", value: "opt1" },
        { name: "Option 2", value: "opt2" }
    ],
    onSelect: (value) => value,
    onEscape: () => null
});
```

## Features

- 🖥️ **Interactive Screens** - Full-screen terminal UIs with navigation
- 📋 **List Components** - Scrollable, sortable, searchable lists
- 🎯 **Multi-column Grids** - Word grids and column-based layouts
- 🔍 **Preview Panes** - Show details for selected items
- ⌨️ **Keyboard Navigation** - Arrow keys, shortcuts, custom bindings
- 🎨 **Customizable UI** - Colors, styles, layouts, and components
- 📍 **Breadcrumb Navigation** - Clear navigation context
- 🔄 **State Management** - React hooks for interactive behavior

## Core Functions

### `showScreen(config: ShowScreenConfig): Promise<any>`

Display a custom screen with full control.

```typescript
const result = await showScreen({
    title: "My Screen",
    onRender: (ctx) => {
        // Register actions
        ctx.setAction("save", () => ctx.close("saved"));
        ctx.setAction("cancel", () => ctx.close(null));
        
        // Set key bindings
        ctx.setKeyBinding([
            { key: "s", caption: "save", action: "save", order: 1 },
            { key: "c", caption: "cancel", action: "cancel", order: 2 }
        ]);
        
        // Set footer
        ctx.setFooter("s to save, c to cancel");
        
        // Return UI
        return h(Box, { flexDirection: "column" },
            h(Text, { color: "cyan" }, "Content here")
        );
    }
});
```

### `showListScreen(config: ShowListScreenConfig): Promise<any>`

Display an interactive list with selection.

```typescript
const selected = await showListScreen({
    title: "Choose an option",
    items: [
        { name: "Build", value: "build" },
        { name: "Test", value: "test" },
        { name: "Deploy", value: "deploy" }
    ],
    onSelect: (value, index) => value,
    onEscape: (index) => null,
    sortable: true,
    maxHeight: 10,
    initialSelectedIndex: 0,
    selectionMarker: "→"
});
```

### `showMultiColumnListScreen(config): Promise<any>`

Display items in a multi-column grid layout.

```typescript
const selected = await showMultiColumnListScreen({
    title: "Word Grid",
    items: ["apple", "banana", "cherry", "date", "elderberry"],
    onSelect: (value, index) => value,
    initialSelectedIndex: 0
});
```

### `showMultiColumnListWithPreviewScreen(config): Promise<any>`

Grid layout with preview pane below.

```typescript
const selected = await showMultiColumnListWithPreviewScreen({
    title: "Word List",
    items: ["apple", "banana", "cherry"],
    getPreviewContent: (item) => ({
        word: item,
        length: item.length,
        vowels: (item.match(/[aeiou]/gi) || []).length
    }),
    onSelect: (value, index) => value
});
```

## UI Components

### Layout Components

```typescript
import { 
    ScreenContainer,
    ScreenRow,
    ScreenTitle,
    ScreenDivider,
    ScreenBody,
    ScreenFooter 
} from '@nmakarov/cli-toolkit/screen';

// Container with border
h(ScreenContainer, {},
    h(ScreenTitle, { text: "My App" }),
    h(ScreenDivider, {}),
    h(ScreenBody, {},
        h(Text, {}, "Content")
    ),
    h(ScreenFooter, { 
        lines: ["esc to exit", "enter to select"] 
    })
);
```

### UI Elements

```typescript
import {
    ListItem,
    TextBlock,
    Divider,
    GridCell,
    InputField
} from '@nmakarov/cli-toolkit/screen';

// List item with selection state
h(ListItem, { isSelected: true }, "Selected Item")

// Text block with styling
h(TextBlock, { 
    text: "Important", 
    color: "red", 
    bold: true 
})

// Horizontal divider
h(Divider, { character: "─", width: 80 })

// Grid cell
h(GridCell, { 
    width: 20, 
    align: "right" 
}, "Cell Content")

// Input field
h(InputField, {
    prompt: "Enter name:",
    value: inputValue,
    onChange: (val) => setInputValue(val)
})
```

### List Components

```typescript
import { 
    ListComponent,
    MultiColumnListComponent,
    MultiColumnListWithPreviewComponent 
} from '@nmakarov/cli-toolkit/screen';

// Single-column list with sorting
h(ListComponent, {
    items: [
        { name: "Item 1", value: "val1" },
        { name: "Item 2", value: "val2" }
    ],
    ctx,
    selectedIndexRef: { current: 0 },
    sortable: true,
    maxHeight: 10,
    selectionMarker: "→"
})

// Multi-column grid
h(MultiColumnListComponent, {
    items: ["word1", "word2", "word3"],
    ctx,
    selectedIndexRef: { current: 0 }
})

// Grid with preview
h(MultiColumnListWithPreviewComponent, {
    items: ["word1", "word2"],
    getPreviewContent: (item) => ({ word: item }),
    ctx,
    selectedIndexRef: { current: 0 }
})
```

## Utilities

### Breadcrumb Builder

```typescript
import { buildBreadcrumb, buildDetailBreadcrumb } from '@nmakarov/cli-toolkit/screen';

buildBreadcrumb(['Menu']);                    // "Menu"
buildBreadcrumb(['Menu', 'Settings']);        // "←  Settings"
buildBreadcrumb(['Menu', 'Words', 'Details']); // "←  Words  ←  Details"

buildDetailBreadcrumb(['Menu', 'Item'], 'Info');  // "←  Item Info"
```

### Footer Builder

```typescript
import { buildFooter, FooterPresets } from '@nmakarov/cli-toolkit/screen';

// Custom footer
const footer = buildFooter({
    navigation: "↑/↓ to navigate",
    actions: "Enter to select",
    escape: "Esc to exit",
    info: "10 items"
});

// Preset footers
FooterPresets.menu();           // ["↑/↓ to navigate, Enter to select, Esc to go back"]
FooterPresets.wordGrid(50);     // Includes "Total: 50 words"
FooterPresets.mainMenu();       // "Esc to exit" instead of "go back"
```

## Context API

The screen context (`ctx`) provides methods for managing screen behavior:

```typescript
onRender: (ctx) => {
    // Actions
    ctx.setAction("myAction", () => { /* handler */ });
    ctx.triggerAction("myAction");
    
    // Key bindings
    ctx.setKeyBinding({ 
        key: "s", 
        caption: "save", 
        action: "myAction", 
        order: 1 
    });
    ctx.updateKeyBinding("s", { enabled: false });
    ctx.removeKeyBinding("s");
    
    // Footer
    ctx.addFooter("Additional info");
    ctx.setFooter(["New footer"]);
    ctx.clearFooter();
    
    // Navigation
    ctx.goBack();      // Navigate back
    ctx.close(value);  // Close screen with value
    ctx.update();      // Force re-render
    
    // Data
    ctx.parentData;    // Data from parent screen
}
```

## Custom Rendering

Customize how list items are rendered:

```typescript
await showListScreen({
    title: "Custom List",
    items: [
        { name: "Item 1", value: { id: 1, status: "active" } },
        { name: "Item 2", value: { id: 2, status: "inactive" } }
    ],
    renderItem: (item, isSelected) => {
        const statusColor = item.value.status === "active" ? "green" : "gray";
        return h(Box, { flexDirection: "column" },
            h(Text, { 
                color: isSelected ? "cyan" : "white",
                bold: isSelected 
            }, item.name),
            h(Text, { 
                color: statusColor, 
                dimColor: true 
            }, `  Status: ${item.value.status}`)
        );
    },
    onSelect: (value) => value
});
```

## Navigation Patterns

### Nested Screens

```typescript
const showSubMenu = async (parentPath: string[]) => {
    return await showListScreen({
        title: buildBreadcrumb([...parentPath, "Submenu"]),
        items: [...],
        onSelect: (value) => value,
        onEscape: () => null  // Go back
    });
};

const showMainMenu = async () => {
    while (true) {
        const choice = await showListScreen({
            title: "Main Menu",
            items: [...],
            onSelect: (value) => value,
            onEscape: () => null  // Exit
        });
        
        if (!choice) break;  // User pressed escape
        
        if (choice === "submenu") {
            await showSubMenu(["Main Menu"]);
        }
    }
};
```

## Scrolling and Sorting

```typescript
await showListScreen({
    title: "Large List",
    items: Array.from({ length: 100 }, (_, i) => ({ 
        name: `Item ${i}`, 
        value: i 
    })),
    sortable: true,              // Enable sorting with 's' key
    maxHeight: 10,               // Show 10 items, scroll for more
    sortHighlightStyle: {        // Customize sort indicator
        color: "black",
        backgroundColor: "yellow",
        bold: true
    },
    onSelect: (value) => value
});
```

## Best Practices

1. **Use breadcrumbs** for nested navigation
2. **Limit maxHeight** for long lists to enable scrolling
3. **Provide escape routes** - always handle `onEscape`
4. **Use `buildBreadcrumb`** for consistent title formatting
5. **Leverage footer presets** for common screen types
6. **Keep renderItem pure** - avoid side effects
7. **Use sortable lists** for large datasets
8. **Test interactive flows** manually (hard to unit test Ink apps)

## See Also

- [Full Reference](FULL_REFERENCE.md) - Complete Screen API
- [Examples](EXAMPLES.md) - Screen examples
- [API Documentation](API.md) - Detailed API reference

