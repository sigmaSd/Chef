- [x] if the latest version is the same as the current version, the Update
      button should be called soemthing else maybe Reinstall

- [x] add a run in terminal button

- [x] if an app is running we should have visual feedback in the app, it should
      be easy to tell if teh app is running and listen to its exit

- [x] The current chef version beign used should be displayed in the ui, this
      might be tricky be cause we need to parse teh chefpath js file right ?

- [x] The install/reinstall button maybe shoukld be at the right of teh actions
      ? because when it disapers (when the prgoream runs) the other gets shifted
      left

- [x] Use gtk blueprint to reduce this too much imperative code

- [x] Rename Chef native apps to Chef apps, uppercase and bold provider titles

- [x] Show "Update Available" button only if there are updates, with yellow
      styling and 🔄 icon

- [x] Add live logs view in the GUI (Togglable with Hamburger menu or Ctrl+L)

- [x] Detect new updates while in the background and notify the user

- [x] Add a setting to enable/disable background notification behavior

- [x] Use a unique appId per Chef script to avoid collisions in desktop files,
      icons, and GTK instances

- [x] Add an exit button that ignores background setting

- [x] Add provider management in the GUI (List, Add, Remove, and Discover from
      JSR)

- [x] Refactor ChefInternal into specialized managers (Paths, Settings,
      Providers)

- [x] Replace non-standard rustJoin with path.join

- [x] Migrate from underscore private members to native JS private fields (#var)

- [x] Prevent duplicate recipe names in add() and refreshRecipes() (prefixing
      providers)

- [x] Fix UI bug where duplicate names caused simultaneous state updates

- [x] Maintain "Updates only" view after an app is updated/reinstalled

- [x] Allow concurrent updates for different apps in the GUI (per-row isBusy)

- [x] Update only the relevant row in the GUI after installation/update (no full
      rerender)

- [x] Add an offline indicator in the GUI header bar
