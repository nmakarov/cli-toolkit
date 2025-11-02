/**
 * Utility functions for Screen System
 */

/**
 * Build breadcrumb-style title
 * @param parts - Parts of the breadcrumb path
 * @returns Formatted breadcrumb
 *
 * Examples:
 *   buildBreadcrumb(['Menu']) → 'Menu'
 *   buildBreadcrumb(['Menu', 'Info']) → '←  Info'
 *   buildBreadcrumb(['Menu', 'Words', 'nefarious']) → '←  Words  ←  nefarious'
 */
export function buildBreadcrumb(parts: string[]): string {
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];

    // Skip first part (root), add arrows with spaces to rest
    return parts.slice(1).map(part => `←  ${part}`).join("  ");
}

/**
 * Create multi-line breadcrumb with details
 * @param path - Navigation path
 * @param suffix - Additional suffix (e.g., 'Details')
 * @returns Formatted breadcrumb with suffix
 *
 * Example:
 *   buildDetailBreadcrumb(['Menu', 'Words', 'nefarious'], 'Details')
 *   → '←  Words  ←  nefarious Details'
 */
export function buildDetailBreadcrumb(path: string[], suffix: string = ""): string {
    if (path.length <= 1) {
        return suffix ? `←  ${suffix}` : path[0] || "";
    }

    const breadcrumb = buildBreadcrumb(path);
    return suffix ? `${breadcrumb} ${suffix}` : breadcrumb;
}
