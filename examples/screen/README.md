# Screen System Examples

This directory contains examples for the screen system module of the CLI toolkit.

## ⚠️ Status

**The screen system module is not yet fully implemented.** 

### Completed ✅
- `src/screen/utils.ts` - Utility functions (breadcrumbs)
- `src/screen/ui-elements.ts` - Reusable UI components
- `src/screen/components.ts` - Core screen layout components
- `src/screen/footer-builder.ts` - Footer builder with presets
- Example files prepared with TypeScript
- Sample data files copied

### Remaining Work ❌
- `src/screen/list-components.ts` - List/grid components (to be converted from `legacy/screenSystem/src/list-components.js`)
- `src/screen/screens.ts` - Main screen functions (to be converted from `legacy/screenSystem/src/screens.js`)
- `src/screen/index.ts` - Update with proper exports

## Planned Examples

### `basic.ts`
Demonstrates the screen system features including:
- Info screen with static content
- Word list with grid layout
- Word list with live preview
- Audio playback integration
- Dynamic footer updates

## Running Examples

Once the screen system is fully implemented, examples can be run with:

```bash
npx tsx examples/screen/basic.ts
```

## Dependencies

- `ink` ^4.0.0
- `react` ^18.0.0
