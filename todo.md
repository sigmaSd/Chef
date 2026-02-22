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
- [x] Maybe we need a refresh button to relook for updates
  - Added a "Refresh" button in the header bar with `view-refresh-symbolic`
    icon.
  - Implemented `Ctrl+R` and `F5` keyboard shortcuts for refreshing.
  - Added "Refresh Recipes (Ctrl+R)" to the hamburger menu.
  - Refresh logic re-triggers provider discovery and update checks for all
    recipes.
- [x] Epic: Add a way to see older version of an app and offer to install them
  - Added `versions` method to `Recipe` interface with pagination support.
  - Implemented `getGithubReleases` and `getNpmVersions` utilities.
  - Updated `BinaryUpdater` and `ChefInternal` to support installing specific
    versions.
  - Replaced latest version label in GUI with a `MenuButton` and `Popover`.
  - Added search and pagination ("Load More") for versions in the GUI.
  - Added "Install custom version" option when searching for unlisted versions.

- Add an option that allows the app to stay active in the background instead of
  exiting
- Make it check for updates automaticlly each minutes, Make sure that updating
  doesnt' conflict with installing, as in if something is already installing
  updates should wait I guess?
