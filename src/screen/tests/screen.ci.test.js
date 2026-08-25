import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

describe("Screen CI", () => {
    let screens;
    let ReactMock;
    let listComponents;
    let inputHandlers;
    let stateStore;
    let stateIndex;

    const renderOutputs = [];

    let utils;
    let footerBuilder;
    let uiElements;
    let screenComponents;

    beforeEach(async () => {
        vi.resetModules();
        inputHandlers = [];
        stateStore = [];
        stateIndex = 0;
        renderOutputs.length = 0;

        vi.doMock("react", () => {
            const mock = {};

            mock.createElement = (type, props = {}, ...children) => {
                const normalizedChildren = children.length === 0
                    ? props?.children === undefined
                        ? undefined
                        : props.children
                    : children.length === 1
                        ? children[0]
                        : children;
                const childArray = Array.isArray(normalizedChildren)
                    ? normalizedChildren
                    : normalizedChildren !== undefined
                        ? [normalizedChildren]
                        : [];
                return {
                    type,
                    props: { ...props, children: normalizedChildren },
                    children: childArray
                };
            };

            mock.useState = (initial) => {
                const idx = stateIndex++;
                if (stateStore[idx] === undefined) {
                    stateStore[idx] = typeof initial === "function" ? initial() : initial;
                }
                const setState = (value) => {
                    stateStore[idx] = typeof value === "function" ? value(stateStore[idx]) : value;
                };
                return [stateStore[idx], setState];
            };

            mock.useEffect = (fn) => {
                fn();
                return () => {};
            };

            mock.useRef = (initial) => ({ current: initial });

            mock.isValidElement = (value) => typeof value === "object" && value !== null && "type" in value;

            mock.cloneElement = (element, props = {}) => ({
                type: element.type,
                props: { ...element.props, ...props },
                children: element.children,
                key: props.key ?? element.key,
            });

            mock.default = mock;

            return mock;
        });

        vi.doMock("ink", () => {
            const render = vi.fn((element) => {
                stateIndex = 0;
                const component = element.type;
                const evaluate = (node) => {
                    if (!node) {
                        return node;
                    }
                    if (Array.isArray(node)) {
                        return node.map(evaluate);
                    }
                    if (typeof node === "object") {
                        if (typeof node.type === "function") {
                            return evaluate(node.type(node.props || {}));
                        }
                        if (node.children) {
                            node.children = node.children.map(evaluate);
                        }
                        return node;
                    }
                    return node;
                };
                const output = evaluate(component(element.props || {}));
                renderOutputs.push(output);
                return { unmount: vi.fn(), element: output };
            });

            const useInput = (handler) => {
                inputHandlers.push(handler);
            };

            const ensureArray = (value) => {
                if (Array.isArray(value)) return value;
                if (value === undefined || value === null) return [];
                return [value];
            };

            const Box = (props = {}, ...children) => {
                const providedChildren = children.length ? children : ensureArray(props.children);
                return { type: "Box", props: { ...props }, children: providedChildren };
            };

            const Text = (props = {}, ...children) => {
                const providedChildren = children.length ? children : ensureArray(props.children);
                return { type: "Text", props: { ...props }, children: providedChildren };
            };

            return { render, useInput, Box, Text };
        });

        screens = await import("../screens.js");
        ReactMock = await import("react");
        listComponents = await import("../list-components.js");
        utils = await import("../utils.js");
        footerBuilder = await import("../footer-builder.js");
        uiElements = await import("../ui-elements.js");
        screenComponents = await import("../components.js");
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    afterAll(() => {
        vi.resetModules();
        vi.unmock("react");
        vi.unmock("ink");
    });

    const createMockCtx = () => {
        const actions = {};
        const keyBindings = [];
        const ctx = {
            setAction: (name, fn) => {
                actions[name] = fn;
            },
            setKeyBinding: (bindingOrBindings) => {
                const arr = Array.isArray(bindingOrBindings) ? bindingOrBindings : [bindingOrBindings];
                arr.forEach(binding => keyBindings.push(binding));
            },
            updateKeyBinding: vi.fn(),
            removeKeyBinding: vi.fn(),
            addFooter: vi.fn(),
            clearFooter: vi.fn(),
            setFooter: vi.fn(),
            setSmartFooter: vi.fn(),
            update: vi.fn(),
            goBack: vi.fn(),
            close: vi.fn(),
            parentData: undefined
        } ;
        return { ctx, actions, keyBindings };
    };

    const getImports = () => ({ utils, footerBuilder, uiElements, screenComponents });

    const evaluateNode = (node) => {
        if (!node) {
            return node;
        }
        if (Array.isArray(node)) {
            return node.map(evaluateNode);
        }
        if (typeof node === "object") {
            if (typeof node.type === "function") {
                return evaluateNode(node.type(node.props || {}));
            }
            const evaluatedChildren = node.children ? node.children.map(evaluateNode) : node.children;
            return { ...node, children: evaluatedChildren };
        }
        return node;
    };

    const findNode = (node, predicate) => {
        if (!node) return null;
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = findNode(item, predicate);
                if (found) return found;
            }
            return null;
        }
        if (typeof node === "object") {
            if (predicate(node)) {
                return node;
            }
            if (node.children) {
                return findNode(node.children, predicate);
            }
        }
        return null;
    };

    const collectText = (node) => {
        if (!node) return [];
        if (typeof node === "string") {
            return [node];
        }
        if (Array.isArray(node)) {
            return node.flatMap(collectText);
        }
        if (typeof node === "object" && node.children) {
            return collectText(node.children);
        }
        return [];
    };

    it("groups key bindings ignoring disabled ones", () => {
        const { groupKeyBindings } = screens;
        const groups = groupKeyBindings([
            { key: "x", caption: "run", action: "run", enabled: false },
            { key: "a", caption: "run", action: "run", order: 2 },
            { key: "b", caption: "stop", action: "stop", order: 1 }
        ] );

        expect(groups).toEqual([
            { keys: ["a"], caption: "run", order: 2 },
            { keys: ["b"], caption: "stop", order: 1 }
        ]);
    });

    it("builds breadcrumbs and detail paths", () => {
        const { buildBreadcrumb, buildDetailBreadcrumb } = getImports().utils;

        expect(buildBreadcrumb([])).toBe("");
        expect(buildBreadcrumb(["Home"])).toBe("Home");
        expect(buildBreadcrumb(["Home", "Info", "Deep"])).toBe("←  Info  ←  Deep");

        expect(buildDetailBreadcrumb(["Root"], "Details")).toBe("←  Details");
        expect(buildDetailBreadcrumb(["Root", "Child"], "Preview")).toBe("←  Child Preview");
        expect(buildDetailBreadcrumb(["Root", "Child", "Leaf"], ""))
            .toBe("←  Child  ←  Leaf");
    });

    it("composes footer messages and presets", () => {
        const { buildFooter, FooterPresets, organizeFooterMessages } = getImports().footerBuilder;

        expect(buildFooter({ navigation: "↑/↓", actions: "Enter", escape: "Esc" }))
            .toEqual(["↑/↓, Enter, Esc"]);

        expect(buildFooter({ info: ["Line A", "Line B"], custom: "Custom" }))
            .toEqual(["Esc to go back", "Line A", "Line B", "Custom"]);

        expect(FooterPresets.menu()).toEqual(["↑/↓ to navigate, Enter to select, Esc to go back"]);
        expect(FooterPresets.wordGrid(10)).toEqual([
            "↑↓←→ to navigate, Enter to select, Esc to go back",
            "Total: 10 words"
        ]);
        expect(FooterPresets.actionMenu(true)).toEqual([
            "↑/↓ to navigate, Enter to select, Esc to go back",
            "Audio available"
        ]);

        expect(organizeFooterMessages(null)).toEqual(["Esc to go back"]);
        expect(organizeFooterMessages([
            "↑ to navigate",
            "Enter to open",
            "Esc to exit",
            "Extra info"
        ])).toEqual([
            "↑ to navigate, Enter to open, Esc to exit",
            "Extra info"
        ]);
    });

    it("renders screen components with layout and footer wrapping", () => {
        const { getScreenWidth, ScreenContainer, ScreenFooter, ScreenDivider, ScreenTitle, ScreenBody, ScreenRow } = getImports().screenComponents;
        const originalColumns = (process.stdout ).columns;
        (process.stdout ).columns = 50;

        expect(getScreenWidth()).toBe(46);
        expect(getScreenWidth(30)).toBe(30);
        expect(getScreenWidth(60)).toBe(46);

        const container = evaluateNode(ScreenContainer({ children: "child" }));
        expect(container.props.width).toBe(46);
        expect(container.props.borderStyle).toBe("single");
        expect(container.props.overflow).toBe("hidden");
        expect(container.props.height).toBeUndefined();
        expect(container.props.maxHeight).toBeGreaterThan(0);

        const title = evaluateNode(ScreenTitle({ text: "Title" }));
        expect(title.children[0].children[0]).toBe("Title");

        const body = evaluateNode(ScreenBody({ children: "Content", alignItems: "center" }));
        expect(body.props.alignItems).toBe("center");

        const row = evaluateNode(ScreenRow({ children: "Row" }));
        expect(row.children[0]).toBe("Row");

        const divider = evaluateNode(ScreenDivider({ width: 5 }));
        expect(divider.children[0]).toHaveLength(5);

        const customElement = ReactMock.createElement("span", {}, "Custom");
        const footer = evaluateNode(ScreenFooter({
            lines: [
                "Line one",
                ["Nested"],
                customElement,
                "\u001b[1mesc\u001b[22m to go back"
            ],
            textStyle: { color: "green", dimColor: false }
        }));

        const footerTexts = footer.children[0].children;
        expect(footerTexts).toHaveLength(4);
        expect(footerTexts[0].props.color).toBe("green");
        expect(footerTexts[1].children[0]).toBe("Nested");
        expect(footerTexts[2].type).toBe("span");
        expect(footerTexts[3].props.dimColor).toBeUndefined();
        expect(footerTexts[3].props.color).toBeUndefined();

        const smartFooter = evaluateNode(ScreenFooter({
            hotkeys: [
                { hotkey: ["esc", "←"], caption: "go back" },
                { hotkey: "enter", caption: "select" },
            ],
        }));
        const smartTexts = findNode(smartFooter, (node) => node.type === "Box" && node.props?.flexDirection === "row");
        const boldKeys = [];
        const collectBold = (node) => {
            if (!node) return;
            if (Array.isArray(node)) { node.forEach(collectBold); return; }
            if (node.props?.bold && typeof (node.children?.[0] ?? node.props?.children) === "string") {
                boldKeys.push(node.children?.[0] ?? node.props.children);
            }
            if (node.children) collectBold(node.children);
        };
        collectBold(smartTexts);
        expect(boldKeys).toEqual(["esc", "←", "enter"]);

        (process.stdout ).columns = originalColumns;
    });

    it("renders UI elements with expected styling", () => {
        const { ListItem, TextBlock, Divider, GridCell, InputField } = getImports().uiElements;

        const listSelected = evaluateNode(ListItem({ children: "Item", isSelected: true, color: "white", backgroundColor: "blue" }));
        const selectedText = findNode(listSelected, (node) => node.type === "Text" && node.props.bold);
        expect(selectedText?.props.color).toBe("blue");
        expect(selectedText?.props.backgroundColor).toBe("white");

        const listUnselected = evaluateNode(ListItem({ children: "Item", dimColor: true }));
        const unselectedText = findNode(listUnselected, (node) => node.type === "Text");
        expect(unselectedText?.props.dimColor).toBe(true);

        const block = evaluateNode(TextBlock({ text: "Hello", bold: true }));
        const blockText = findNode(block, (node) => node.type === "Text" && node.props.bold);
        expect(blockText?.children[0]).toBe("Hello");

        const div = evaluateNode(Divider({ character: "-", width: 3 }));
        const divText = findNode(div, (node) => node.type === "Text");
        expect(divText?.children[0]).toBe("---");

        const cell = evaluateNode(GridCell({ children: "Cell", width: 10, align: "right" }));
        expect(cell.props.width).toBe(10);
        const cellText = findNode(cell, (node) => node.type === "Text");
        expect(cellText?.props.textAlign).toBe("right");

        const input = evaluateNode(InputField({ prompt: "Enter", value: "test" }));
        const promptNode = findNode(input, (node) => node.type === "Text" && node.children?.includes("Enter"));
        expect(promptNode).not.toBeNull();
        const valueNode = findNode(input, (node) => node.type === "Text" && collectText(node).join("").includes("test"));
        expect(valueNode).not.toBeNull();
    });

    it("formats key bindings with strings, custom components, and short mode", () => {
        const { bindingsToFooterHotkeys, formatKeys } = screens;
        const custom = ReactMock.createElement("span", { key: "c" }, "Custom");

        const items = bindingsToFooterHotkeys([
            { key: "b", caption: "stop", action: "stop", order: 2 },
            { key: "a", caption: () => custom, action: "custom", order: 1 }
        ] , "long");

        expect(items[0].node).toEqual(custom);
        expect(items[1]).toEqual({ hotkey: ["b"], caption: "stop", order: 2 });

        const shortItems = bindingsToFooterHotkeys([
            { key: "x", caption: "skip", action: "skip" },
            { key: "y", caption: "skip", action: "skip" }
        ] , "short");

        expect(shortItems).toEqual([{ hotkey: ["x", "y"], caption: "", order: 999 }]);
        expect(formatKeys(["escape", "leftArrow", "unknown"])).toBe("esc/←/unknown");
    });

    it("runs showScreen with context operations and custom key bindings", async () => {
        vi.useFakeTimers();
        const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        let receivedCtx;

        const promise = screens.showScreen({
            title: "Demo",
            onRender: (ctx) => {
                receivedCtx = ctx;
                ctx.setAction("custom", () => ctx.close("done"));
                ctx.setKeyBinding({ key: "custom", caption: "do", action: "custom", order: 3 });
                ctx.setKeyBinding({ key: "escape", caption: "override", action: "custom" });
                ctx.setKeyBinding({ key: "temp", caption: "Temp", action: "custom", enabled: false });
                ctx.updateKeyBinding("temp", { enabled: true });
                ctx.removeKeyBinding("temp");
                ctx.addFooter("line");
                ctx.setFooter(["line2"]);
                ctx.setSmartFooter();
                ctx.setSmartFooter([{ hotkey: "x", caption: "extra" }]);
                ctx.clearFooter();
                return ReactMock.createElement("div", {});
            }
        });

        expect(typeof receivedCtx.setAction).toBe("function");
        receivedCtx.setKeyBinding({ key: "conditional", caption: "cond", action: "custom", condition: () => false });

        const handler = inputHandlers[0];
        handler("conditional", { conditional: true });
        handler("custom", { custom: true });

        vi.runAllTimers();
        await expect(promise).resolves.toBe("done");
        expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("Cannot override protected key"));
        vi.useRealTimers();
    });

    it("goes back using default action", async () => {
        vi.useFakeTimers();
        let ctxRef;
        const promise = screens.showScreen({
            title: "Back",
            onRender: (ctx) => {
                ctxRef = ctx;
                return ReactMock.createElement("div", {});
            }
        });

        ctxRef.goBack();
        vi.runAllTimers();
        await expect(promise).resolves.toBeNull();
        vi.useRealTimers();
    });

    it("configures showListScreen actions and bindings", async () => {
        const onSelect = vi.fn(() => "selected");
        const onEscape = vi.fn(() => "escape");
        const items = [
            { name: "A", value: "alpha" },
            { name: "B", value: "beta" }
        ];

        vi.useFakeTimers();
        const promiseSelect = screens.showListScreen({
            title: "Menu",
            items,
            onSelect,
            onEscape,
            initialSelectedIndex: 1,
            sortable: true,
            selectionMarker: ">"
        });

        const handlerSelect = inputHandlers.at(-1);
        handlerSelect("return", { return: true });
        vi.runAllTimers();
        await expect(promiseSelect).resolves.toBe("selected");
        expect(onSelect).toHaveBeenCalledWith("beta", 1);

        inputHandlers.length = 0;
        vi.useFakeTimers();

        const promiseEscape = screens.showListScreen({
            title: "Menu",
            items,
            onSelect,
            onEscape,
            initialSelectedIndex: 0
        });

        const handlerEscape = inputHandlers.at(-1);
        handlerEscape("", { escape: true });
        vi.runAllTimers();
        await expect(promiseEscape).resolves.toBe("escape");
        expect(onEscape).toHaveBeenCalledWith(0);
        vi.useRealTimers();
    });

    it("ListComponent supports sorting, scrolling, and custom renderer", () => {
        const { ListComponent } = listComponents;
        const { ctx, actions, keyBindings } = createMockCtx();

        const items = [
            { name: "Alpha", value: "alpha" },
            { name: "Beta", value: "beta" },
            { name: "Gamma", value: "gamma" },
            { name: "Delta", value: "delta" }
        ];

        const selectedIndexRef = { current: 1 };
        const tree = evaluateNode(ListComponent({
            items,
            ctx,
            selectedIndexRef,
            sortable: true,
            maxHeight: 2,
            selectionMarker: ">"
        }));

        expect(Object.keys(actions)).toEqual(expect.arrayContaining([
            "moveUp",
            "moveDown",
            "scrollUp",
            "scrollDown",
            "pageUp",
            "pageDown",
            "toggleSort"
        ]));

        actions.moveUp();
        expect(selectedIndexRef.current).toBe(0);
        actions.moveDown();
        expect(selectedIndexRef.current).toBe(1);
        actions.scrollDown();
        actions.scrollUp();
        actions.pageDown();
        expect(selectedIndexRef.current).toBe(3);
        actions.pageUp();
        expect(selectedIndexRef.current).toBe(1);
        actions.toggleSort();
        expect(ctx.update).toHaveBeenCalled();

        expect(keyBindings.map(binding => binding.key)).toEqual(expect.arrayContaining([
            "upArrow",
            "downArrow",
            "pageUp",
            "pageDown",
        ]));
        expect(keyBindings.some((b) => b.key === "upArrow" && b.meta)).toBe(true);

        const rows = tree.children;
        expect(rows).toHaveLength(2);
        const firstRowTextContent = collectText(rows[0]).join("");
        expect(firstRowTextContent).toContain("Alpha");
        expect(firstRowTextContent.length).toBeGreaterThan(0);
    });

    it("ListComponent uses custom renderer and indicators", () => {
        const { ListComponent } = listComponents;
        const { ctx } = createMockCtx();
        const items = [
            { name: "Alpha", value: "alpha" },
            { name: "Beta", value: "beta" }
        ];

        const renderItem = vi.fn((item, isSelected, displayIndex) =>
            ReactMock.createElement("Text", { key: `custom-${displayIndex}` }, `${item.name}${isSelected ? "*" : ""}`)
        );

        const tree = evaluateNode(ListComponent({
            items,
            ctx,
            selectedIndexRef: { current: 0 },
            renderItem,
            maxHeight: 1,
            selectionMarker: "*"
        }));

        expect(renderItem).toHaveBeenCalledWith(items[0], true, 0);
        const rowText = collectText(tree.children[0]).join("");
        expect(rowText).toContain("Alpha");
        expect(rowText).toContain("*");
    });

    it("MultiColumnListComponent registers navigation and respects goBack", () => {
        const { MultiColumnListComponent } = listComponents;
        const { ctx, actions, keyBindings } = createMockCtx();
        const items = ["one", "two", "three", "four"]; 
        const selectedIndexRef = { current: 0 };

        const tree = evaluateNode(MultiColumnListComponent({ items, ctx, selectedIndexRef }));
        expect(Object.keys(actions)).toEqual(expect.arrayContaining([
            "moveUp",
            "moveDown",
            "moveLeft",
            "moveRight"
        ]));

        actions.moveLeft();
        expect(ctx.goBack).toHaveBeenCalled();
        ctx.goBack.mockReset();
        actions.moveRight();
        expect(selectedIndexRef.current).toBeGreaterThan(0);

        expect(keyBindings.length).toBeGreaterThanOrEqual(4);
        expect(tree.children.length).toBeGreaterThan(0);
    });

    it("MultiColumnListWithPreviewComponent renders string, object, and element previews", () => {
        const { MultiColumnListWithPreviewComponent } = listComponents;

        const items = ["alpha", "beta"];

        const stringCtx = createMockCtx();
        const stringTree = evaluateNode(MultiColumnListWithPreviewComponent({ items, ctx: stringCtx.ctx, selectedIndexRef: { current: 0 } }));
        expect(collectText(stringTree).join(" ")).toContain("alpha");

        const objectCtx = createMockCtx();
        const objectTree = evaluateNode(MultiColumnListWithPreviewComponent({
            items,
            ctx: objectCtx.ctx,
            selectedIndexRef: { current: 0 },
            getPreviewContent: () => ({ label: "value" })
        }));
        expect(collectText(objectTree).join(" ")).toContain("label: value");

        const elementCtx = createMockCtx();
        const elementTree = evaluateNode(MultiColumnListWithPreviewComponent({
            items,
            ctx: elementCtx.ctx,
            selectedIndexRef: { current: 0 },
            getPreviewContent: () => ReactMock.createElement("Text", {}, "Preview Element")
        }));
        expect(collectText(elementTree).join(" ")).toContain("Preview Element");
    });

    it("configures showMultiColumnListScreen", async () => {
        const onSelect = vi.fn(() => "picked");
        const items = ["one", "two", "three"];

        vi.useFakeTimers();

        const promise = screens.showMultiColumnListScreen({
            title: "Grid",
            items,
            onSelect,
            initialSelectedIndex: 2
        });

        const handler = inputHandlers.at(-1);
        handler("return", { return: true });
        vi.runAllTimers();
        await expect(promise).resolves.toBe("picked");
        expect(onSelect).toHaveBeenCalledWith("three", 2);
        vi.useRealTimers();
    });

    it("configures showMultiColumnListWithPreviewScreen", async () => {
        const onSelect = vi.fn(() => "previewed");
        const getPreview = vi.fn((item) => ({ name: item }));
        const items = ["alpha", "beta"];

        vi.useFakeTimers();

        const promise = screens.showMultiColumnListWithPreviewScreen({
            title: "Preview",
            items,
            getPreviewContent: getPreview,
            onSelect
        });

        const handler = inputHandlers.at(-1);
        handler("return", { return: true });
        vi.runAllTimers();
        await expect(promise).resolves.toBe("previewed");
        expect(onSelect).toHaveBeenCalledWith("alpha", 0);
        vi.useRealTimers();
    });
});

