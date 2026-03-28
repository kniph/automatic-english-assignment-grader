# Grading References

This folder stores reusable grading context that should be injected into the AI grading prompt automatically.

Use cases:
- recurring main characters across a whole Howdy level
- recurring places / named objects
- workbook-specific visual conventions
- unit-level context that should not be retyped into `supplemental_notes` every time

File loading order for an assignment:

1. `global.md`
2. `howdy-<level>.md`
3. `howdy-<level>-unit-<unit>.md`
4. `howdy-<level>-unit-<unit>-book-<book>.md`

Example for Howdy 1 Unit 1 Workbook A:

1. `global.md`
2. `howdy-1.md`
3. `howdy-1-unit-1.md`
4. `howdy-1-unit-1-book-a.md`

Guidelines:
- Keep entries short and factual.
- Focus on identity cues that help the model distinguish characters in pictures.
- Do not copy whole storybooks or long lesson text.
- Use `supplemental_notes` in teacher upload for assignment-specific answers such as matching pairs or skip rules.

