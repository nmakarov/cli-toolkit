/**
 * Reusable UI elements for the screen system
 */

import { createElement as h } from "react";
import { Box, Text } from "ink";

// Types







































/**
 * List item component
 */
export function ListItem({ 
    children, 
    isSelected = false, 
    color = "white", 
    backgroundColor, 
    bold = false, 
    dimColor = false 
}) {
    return h(Box, {},
        h(Text, {
            color: isSelected ? backgroundColor || "green" : color,
            backgroundColor: isSelected ? color : backgroundColor,
            bold: isSelected || bold,
            dimColor: !isSelected && dimColor
        }, children)
    );
}

/**
 * Text block component with customizable styling
 */
export function TextBlock({ 
    text, 
    color = "white", 
    dimmed = false, 
    bold = false, 
    maxWidth: _maxWidth 
}) {
    return h(Box, {},
        h(Text, { 
            color, 
            dimColor: dimmed, 
            bold 
        }, text)
    );
}

/**
 * Horizontal divider
 */
export function Divider({ character = "─", width = 80 }) {
    return h(Box, { marginY: 1 },
        h(Text, { dimColor: true }, character.repeat(width))
    );
}

/**
 * Grid cell component
 */
export function GridCell({ 
    children, 
    width, 
    color = "white", 
    backgroundColor, 
    bold = false, 
    dimColor = false, 
    align = "left" 
}) {
    return h(Box, { width },
        h(Text, {
            color,
            backgroundColor,
            bold,
            dimColor,
            textAlign: align
        }, children)
    );
}

/**
 * Input field component
 */
export function InputField({ prompt, value, onChange: _onChange, onSubmit: _onSubmit }) {
    return h(Box, { flexDirection: "column" },
        h(Text, {}, prompt),
        h(Box, { marginTop: 1 },
            h(Text, { color: "cyan" }, " > ", value, "_")
        )
    );
}