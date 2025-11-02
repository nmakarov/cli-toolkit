/**
 * Reusable UI elements for the screen system
 */

import React, { createElement as h } from "react";
import { Box, Text } from "ink";

// Types
export interface ListItemProps {
    children: React.ReactNode;
    isSelected?: boolean;
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    dimColor?: boolean;
}

export interface TextBlockProps {
    text: string;
    color?: string;
    dimmed?: boolean;
    bold?: boolean;
    maxWidth?: number;
}

export interface DividerProps {
    character?: string;
    width?: number;
}

export interface GridCellProps {
    children: React.ReactNode;
    width?: number;
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    dimColor?: boolean;
    align?: "left" | "center" | "right";
}

export interface InputFieldProps {
    prompt: string;
    value: string;
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
}

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
}: ListItemProps): JSX.Element {
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
    maxWidth 
}: TextBlockProps): JSX.Element {
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
export function Divider({ character = "─", width = 80 }: DividerProps): JSX.Element {
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
}: GridCellProps): JSX.Element {
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
export function InputField({ prompt, value, onChange, onSubmit }: InputFieldProps): JSX.Element {
    return h(Box, { flexDirection: "column" },
        h(Text, {}, prompt),
        h(Box, { marginTop: 1 },
            h(Text, { color: "cyan" }, " > ", value, "_")
        )
    );
}