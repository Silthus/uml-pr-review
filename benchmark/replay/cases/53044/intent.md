# fix(notebooks): broken table bubble menu

The notebook table editing experience is broken: the table BubbleMenu is always visible and overlaps the text formatting menu. This change replaces the BubbleMenu with Notion-style grip handles. Hovering a table cell shows a small drag-icon handle beside its row and above its column, and clicking a handle opens a popover with that row's or column's actions (insert before or after, delete). The handles sit in an invisible wrapper that bridges the gap to the table so they do not flicker, and hover and menu state is local React state.

Make the change in `frontend/src/scenes/notebooks/Notebook/TableMenu.tsx`: an exported `TableMenu` component that renders a grip handle beside the hovered cell's row and one above its column. Each handle is a small clickable drag icon that opens a popover menu with that row's or column's actions.

Follow the codebase's conventions. Do not run git.
