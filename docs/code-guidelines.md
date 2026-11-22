# Code guidelines

## Lists over cards for long collections

- Use compact, scannable expandable lists (`<details class="roster-row">` inside `.roster-list`) instead of multi-column card grids for any collection that can grow beyond a few items — including the guild roster, professions/crafters, recipes, guild bank inventory, and account characters.
- Keep each collapsed `<summary>` row to a single compact, scannable line with primary identity, key badges, and inline summary metrics (for example, `Alchemy (137)`, stock count, or crafter count).
- Place secondary metadata, progress bars, source breakdowns, recipe lists, and forms inside the expanded row body.
- Reserve card layouts only for small, fixed-count summary blocks (such as the 3 top-level Guild Hall stat cards or login choices).

## Filtering and sorting

- Provide practical filters on long lists (search query, profession, profession skill level, rank, character level) and sort results so the most relevant entries (such as highest-skill or highest-reputation characters) appear first.
- Filter bars (`form.filter-bar` and `form[data-auto-filter]`) auto-apply on change (immediately for selects, checkboxes, and date pickers; debounced for text and number inputs) so users do not have to click Submit.
- Every table list (`.roster-list[data-sortable-table]`) must have clickable column headers (`button.sort-header[data-sort-col]`) that toggle ascending/descending sort with a visible direction indicator (`▲` / `▼`), keeping empty or `N/A` values at the bottom.
- Any collection that can grow into a long list (roster, activity feed, professions/recipes, bank inventory, bank history) must use pagination (`<Pagination />`) or infinite scroll.

## Database schema

- Normalize structured data into relational PostgreSQL tables with explicit columns, foreign keys, and constraints. Do not store known-schema data in `json` or `jsonb` columns.

## General UI rules

- Follow `AGENTS.md`: never add subtitles, taglines, or eyebrow text anywhere.
- Use Astro components and the vendored Fantasy RTS Arcane theme.
- Keep all lists keyboard-accessible and responsive without horizontal overflow on mobile.
- Store timestamps in UTC in PostgreSQL, but always render dates and times in the user's local browser timezone via `<LocalTime />` (`time[data-local-time]`) or browser-local `toLocaleString()`. Never hardcode `timeZone: 'UTC'` in user-facing UI.
