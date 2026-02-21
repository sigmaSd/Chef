# Guidelines

Start with the easiest tasks or those with dependencies. Complete them one by
one, summarizing work and obtaining user confirmation before ticking off items
and proceeding. Update task descriptions as implementation details evolve.

# Progress

- [x] **Add Live Log View to GUI**
  - Integrated a dedicated "Logs" page in the `Adw.ViewStack`.
  - Implemented a native hamburger menu using `GMenu` and `GActions`
    (`win.toggle-logs`, `win.about`).
  - Set up live log streaming via
    `journalctl -f -a -o cat -t io.github.sigmasd.chef.desktop --since "[app_start_time]"`.
  - Implemented ANSI escape code stripping for clean log output.
  - Added a floating "Scroll to Bottom" button using an `Overlay` widget.
  - Enabled a global `Ctrl+L` keyboard shortcut with visible menu hints.
  - Added a "Back" button for easy navigation between recipes and logs.
  - Extended the vendored GTK library with missing symbols and classes
    (`Separator`, `Adjustment`, `TextView`, `TextBuffer`, `ViewStack`,
    `AboutWindow`, `Overlay`).

# Upcoming Tasks

- [x] Start with the window maximized
- [x] Improve the "Update Available" toggle icon
  - Replaced the emoji with a standard symbolic icon.
  - Added an update count to the tooltip for better UX.
  - Maintained the "warning" highlight when updates are available.
