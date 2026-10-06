# Sai Space Realty CRM: screens for Figma

- `Sai-Space-CRM-Screens-Figma.svg`: one board with every Phase 1 screen, grouped and labelled
  (desktop frames 1440×900, phone frames 390×844).
- `screens/*.png`: the same 14 screens as separate high-resolution images.

## Import into Figma

1. Open Figma and create a new design file.
2. Drag `Sai-Space-CRM-Screens-Figma.svg` onto the canvas (or File → Place image).
3. Each screen arrives as its own group, named after the screen (e.g. `employee-add`).
   Select one and press Ctrl+Alt+G (Frame selection) to turn it into a frame, so you can link frames with **Prototype** arrows for a click-through demo.

## Notes

- The screens are pictures of the real app, not editable Figma layers. Titles and labels on the board are editable text.
- Every screen uses sample data. The sign-in screens are shown as they will look once the live server is connected.
- To refresh after new modules ship, re-run the screenshot script (dev preview mode: `http://localhost:5173/?preview=owner`).
