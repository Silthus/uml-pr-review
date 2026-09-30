# Notebooks

Notebooks: the rich-text editor, its nodes, and the menus around them.

## invariants
- buttons are LemonButtons: Every clickable button in notebooks renders through LemonButton, not a raw `<button>`.
  over: every TSX file under frontend/src/scenes/notebooks except the listed residual
  via: lint oxlint:react/forbid-elements matching "<button>"
  because: LemonButton carries the disabled, loading, and focus states, and a raw button drifts from them
  kinds: none
