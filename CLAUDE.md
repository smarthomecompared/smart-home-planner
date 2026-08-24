# CLAUDE.md

Follow the repository guidelines in @AGENTS.md.

## Key reminders

- **Changelog:** Always add entries to the latest (topmost) version in `smart-home-planner/CHANGELOG.md` — it is the in-development release. Do not create a new version section or bump `version` in `config.yaml` unless explicitly asked. See the "Changelog & Versioning" section in AGENTS.md.
- **Changelog entry style:** Each entry is one short sentence. Never write multi-sentence entries or pile up clauses — split anything longer into separate entries, and leave the technical detail out.

## Design System (UniFi OS-inspired)

The app UI (`smart-home-planner/src/`) follows a UniFi OS-inspired dark design language. All new or modified UI must match it.

- **Colors:** Always use the CSS variables defined in `:root` of `src/css/common.css` — never hardcode new colors. Key values: app background `#101216` (`--bg-color`), wells/inputs `#17191f` (`--bg-secondary`), panels `#1c1f26` (`--card-bg`), top bar/rail `#16181d` (`--rail-bg`), hairline borders `#2b303b` (`--border-color`), accent blue `#006fff` (`--primary-color`), success `#38cc65`, warning `#f5a524`, danger `#f0383b`, text `#f4f5f7` / `#b0b6c2` / `#7e8595`.
- **Typography:** Lato (loaded from Google Fonts with system-font fallback), 15px root size. Headings are plain white and bold — never use gradient text.
- **Surfaces are flat:** no decorative gradients, glows, or dramatic shadows. Panels are `--card-bg` with a 1px `--border-color` hairline. Border radii: 8–10px for panels/cards, 6px for buttons/inputs, 4px for badges/chips/tags.
- **Shell:** fixed 52px top bar (logo + app name on the left, global search on the right) plus a fixed 64px left icon rail with hover tooltips; the active item uses `--primary-light` background with `--primary-text` icon. At ≤640px the rail becomes a slide-in drawer toggled from the hamburger button.
- **Buttons:** primary is solid blue (`--primary-color`, hover `--primary-hover`); secondary is a dark surface with hairline border; destructive row/card actions are ghost buttons with red icon/text; destructive confirmation dialogs show a solid red confirm button (handled automatically by `openDialog` in `common.js`).
- **Toggle switches:** every on/off control uses the global `.ui-switch` class (a restyled `<input type="checkbox">` defined in `common.css`) — never build a custom track/thumb switch.
- **States and hover:** hover changes background/border color only — no `translateY`, scale, or shadow lifts. Status badges use a tinted background (~15–20% alpha) with colored text. Stat tiles are neutral panels with only the value in the status color.
