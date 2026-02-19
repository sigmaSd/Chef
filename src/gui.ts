import {
  Application,
  ApplicationWindow,
  Box,
  Builder,
  Button,
  Entry,
  EventControllerKey,
  ExpanderRow,
  Label,
  ListBox,
  ListBoxRow,
  MenuButton,
  ModifierType,
  Popover,
  ProgressBar,
  SearchBar,
  SearchEntry,
  SizeGroup,
  ToggleButton,
} from "@sigmasd/gtk/gtk4";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import type { ChefInternal } from "./chef-internal.ts";
import type { Recipe } from "../mod.ts";
import { setStatusListener } from "./dax_wrapper.ts";
import { decodeBase64 } from "@std/encoding/base64";
import guiUiJson from "./ui/gen/gui.json" with { type: "json" };
import recipeRowUiJson from "./ui/gen/recipe_row.json" with { type: "json" };

export async function startGui(chef: ChefInternal) {
  Application.setName("Chef");
  const app = new Application("io.github.sigmasd.chef", 0);
  const eventLoop = new EventLoop();

  app.onActivate(() => {
    const builder = new Builder();
    const uiData = new TextDecoder().decode(decodeBase64(guiUiJson.value));
    builder.addFromString(uiData);

    const window = builder.get("window", ApplicationWindow)!;
    const versionLabel = builder.get("version_label", Label)!;
    const updateAllBtn = builder.get("update_all_btn", Button)!;
    const editRecipesBtn = builder.get("edit_recipes_btn", Button)!;
    const cancelBtn = builder.get("cancel_btn", Button)!;
    const listBox = builder.get("list_box", ListBox)!;
    const headerRow = builder.get("header_row", ListBoxRow)!;
    const editorEntry = builder.get("editor_entry", Entry)!;
    const terminalEntry = builder.get("terminal_entry", Entry)!;
    const saveSettingsBtn = builder.get("save_settings_btn", Button)!;
    const statusLabel = builder.get("status_label", Label)!;
    const progressBar = builder.get("progress_bar", ProgressBar)!;

    const searchBtn = builder.get("search_btn", ToggleButton)!;
    const updatesOnlyBtn = builder.get("updates_only_btn", ToggleButton)!;
    const searchBar = builder.get("search_bar", SearchBar)!;
    const searchEntry = builder.get("search_entry", SearchEntry)!;

    searchBar.connectEntry(searchEntry);
    searchBar.setKeyCaptureWidget(window);

    searchBtn.onToggled(() => {
      searchBar.setSearchMode(searchBtn.getActive());
    });

    searchBar.onNotify("search-mode-enabled", () => {
      searchBtn.setActive(searchBar.getSearchMode());
    });

    const applyFilters = () => {
      const filterText = searchEntry.getText().toLowerCase();
      const updatesOnly = updatesOnlyBtn.getActive();

      // Track which expanders should be visible
      const expanderVisibility = new Map<ExpanderRow, boolean>();

      let anyUpdate = false;
      for (const r of recipeRows) {
        if (r.isInstalled && r.hasUpdate) {
          anyUpdate = true;
        }

        const matchesSearch = !filterText ||
          r.name.toLowerCase().includes(filterText);
        const matchesUpdate = !updatesOnly || (r.isInstalled && r.hasUpdate);
        const matches = matchesSearch && matchesUpdate;

        r.row.setVisible(matches);
        if (matches) {
          expanderVisibility.set(r.expanderRow, true);
        }
      }

      // Set visibility of expanders based on their children
      for (const r of recipeRows) {
        r.expanderRow.setVisible(!!expanderVisibility.get(r.expanderRow));
      }

      updateAllBtn.setLabel(updatesOnly ? "Update Available" : "Update All");

      if (anyUpdate) {
        updatesOnlyBtn.setVisible(true);
        updatesOnlyBtn.addCssClass("warning");
        updatesOnlyBtn.setLabel("🔄");
      } else {
        updatesOnlyBtn.setVisible(false);
        updatesOnlyBtn.setActive(false);
      }
    };

    updatesOnlyBtn.onToggled(applyFilters);

    const nameGroup = builder.get("name_group", SizeGroup)!;
    const versionGroup = builder.get("version_group", SizeGroup)!;
    const latestVersionGroup = builder.get("latest_version_group", SizeGroup)!;
    const statusGroup = builder.get("status_group", SizeGroup)!;
    const actionsGroup = builder.get("actions_group", SizeGroup)!;

    let abortController: AbortController | null = null;
    const recipeRows: {
      row: ListBoxRow;
      setSensitive: (sensitive: boolean) => void;
      updateRunningStatus: (running: boolean) => void;
      updateStatusLabel: (text: string) => void;
      name: string;
      group?: string;
      expanderRow: ExpanderRow;
      isInstalled: boolean;
      hasUpdate: boolean;
    }[] = [];

    searchEntry.onChanged(applyFilters);

    const keyController = new EventControllerKey();
    keyController.onKeyPressed((keyval, _keycode, state) => {
      // Ctrl+f
      if (
        (state & ModifierType.CONTROL_MASK) &&
        (keyval === 102 || keyval === 70)
      ) {
        searchBar.setSearchMode(!searchBar.getSearchMode());
        if (searchBar.getSearchMode()) {
          searchEntry.grabFocus();
        }
        return true;
      }
      // Escape
      if (keyval === 65307) {
        if (searchBar.getSearchMode()) {
          searchBar.setSearchMode(false);
          return true;
        }
      }
      return false;
    });
    window.addController(keyController);

    versionLabel.setText(`v${chef.chefVersion}`);
    editorEntry.setText(chef.getEditorCommand());
    chef.getTerminalCommand().then((cmd) => terminalEntry.setText(cmd));

    saveSettingsBtn.onClick(() => {
      chef.setEditorCommand(editorEntry.getText());
      chef.setTerminalCommand(terminalEntry.getText());
      // The popover is handled by GtkMenuButton in the UI file,
      // but we might want to close it manually.
      // For now, let's assume it stays open or closes on focus loss.
    });

    const refreshList = async (skipProviderRefresh = false) => {
      if (!skipProviderRefresh) {
        statusLabel.setText("Refreshing recipes...");
      }
      listBox.removeAll();
      listBox.append(headerRow);

      recipeRows.length = 0;

      if (!skipProviderRefresh) {
        await chef.refreshRecipes();
      }
      const allRecipes = chef.recipes;
      statusLabel.setText("Idle");

      const recipesByProvider: Record<string, Recipe[]> = {};
      for (const recipe of allRecipes) {
        const provider = recipe.provider || "Chef apps";
        if (!recipesByProvider[provider]) recipesByProvider[provider] = [];
        recipesByProvider[provider].push(recipe);
      }

      // Sort providers: "Chef apps" first, then others alphabetically
      const sortedProviders = Object.keys(recipesByProvider).sort((a, b) => {
        if (a === "Chef apps") return -1;
        if (b === "Chef apps") return 1;
        return a.localeCompare(b);
      });

      for (const provider of sortedProviders) {
        const expander = new ExpanderRow();
        const titleCaseProvider = provider.split(" ").map((word) =>
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(" ");
        expander.setTitle(
          `${titleCaseProvider} (${recipesByProvider[provider].length})`,
        );
        expander.setExpanded(true);
        listBox.append(expander);

        // Sort recipes within each provider alphabetically
        const providerRecipes = recipesByProvider[provider].sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        for (const recipe of providerRecipes) {
          const {
            row,
            setSensitive,
            updateRunningStatus,
            updateStatusLabel,
          } = createRecipeRow(
            chef,
            recipe,
            {
              nameGroup,
              versionGroup,
              latestVersionGroup,
              statusGroup,
              actionsGroup,
            },
            refreshList,
            recipeRows,
            (isInstalled, hasUpdate) => {
              const rowObj = recipeRows.find((r) => r.name === recipe.name);
              if (rowObj) {
                rowObj.isInstalled = isInstalled;
                rowObj.hasUpdate = hasUpdate;
                applyFilters();
              }
            },
          );
          recipeRows.push({
            row,
            setSensitive,
            updateRunningStatus,
            updateStatusLabel,
            name: recipe.name,
            group: recipe._group,
            expanderRow: expander,
            isInstalled: false,
            hasUpdate: false,
          });
          expander.addRow(row);
        }
      }
      applyFilters();
    };

    chef.setBinaryStatusListener((name, running) => {
      const row = recipeRows.find((r) => r.name === name);
      if (row) {
        row.updateRunningStatus(running);
      }
    });

    updateAllBtn.onClick(async () => {
      const updatesOnly = updatesOnlyBtn.getActive();
      updateAllBtn.setSensitive(false);
      updateAllBtn.setLabel(
        updatesOnly ? "Updating Available..." : "Updating All...",
      );
      cancelBtn.setVisible(true);
      recipeRows.forEach((r) => r.setSensitive(false));

      abortController = new AbortController();
      try {
        if (updatesOnly) {
          const toUpdate = recipeRows.filter((r) =>
            r.row.getVisible() && r.isInstalled && r.hasUpdate
          );
          for (const r of toUpdate) {
            if (abortController.signal.aborted) break;
            await chef.installOrUpdate(r.name, {
              signal: abortController.signal,
            });
          }
        } else {
          await chef.updateAll({ signal: abortController.signal });
        }
        await refreshList();
      } catch (e) {
        console.error(e);
      } finally {
        updateAllBtn.setSensitive(true);
        updateAllBtn.setLabel(updatesOnly ? "Update Available" : "Update All");
        cancelBtn.setVisible(false);
        recipeRows.forEach((r) => r.setSensitive(true));
        abortController = null;
      }
    });

    editRecipesBtn.onClick(() => {
      const chefPath = chef.edit();
      if (chefPath) {
        const fullCommand = chef.getEditorCommand();
        const [cmd, ...args] = fullCommand.split(" ");
        new Deno.Command(cmd, { args: [...args, chefPath] }).spawn();
      }
    });

    cancelBtn.onClick(() => {
      if (abortController) {
        abortController.abort();
      }
    });

    // Initial populate
    refreshList();

    // Register dax command listener
    setStatusListener((status) => {
      if (status.status === "running") {
        let text = status.command || "Running...";
        if (
          status.progress !== undefined && status.loaded !== undefined &&
          status.total !== undefined
        ) {
          progressBar.setVisible(true);
          progressBar.setFraction(status.progress);
          text += ` [${formatBytes(status.loaded)} / ${
            formatBytes(status.total)
          }]`;
        } else {
          progressBar.setVisible(false);
        }
        statusLabel.setText(text);
      } else {
        statusLabel.setText("Idle");
        progressBar.setVisible(false);
      }
    });

    window.onCloseRequest(() => {
      app.quit();
      // Ensure the process exits
      setTimeout(() => {
        Deno.exit(0);
      }, 100);
      return false;
    });

    window.present();
  });

  await eventLoop.start(app);
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function createRecipeRow(
  chef: ChefInternal,
  recipe: Recipe,
  groups: {
    nameGroup: SizeGroup;
    versionGroup: SizeGroup;
    latestVersionGroup: SizeGroup;
    statusGroup: SizeGroup;
    actionsGroup: SizeGroup;
  },
  refreshList: (skipProviderRefresh?: boolean) => Promise<void>,
  recipeRows: {
    setSensitive: (sensitive: boolean) => void;
    updateStatusLabel: (text: string) => void;
    name: string;
    group?: string;
    expanderRow: ExpanderRow;
  }[],
  onStatusChanged: (isInstalled: boolean, hasUpdate: boolean) => void,
): {
  row: ListBoxRow;
  setSensitive: (sensitive: boolean) => void;
  updateRunningStatus: (running: boolean) => void;
  updateStatusLabel: (text: string) => void;
} {
  const builder = new Builder();
  const uiData = new TextDecoder().decode(decodeBase64(recipeRowUiJson.value));
  builder.addFromString(uiData);

  const row = builder.get("recipe_row", ListBoxRow)!;
  const nameLabel = builder.get("name_label", Label)!;
  const versionLabel = builder.get("version_label", Label)!;
  const latestVersionLabel = builder.get("latest_version_label", Label)!;
  const statusLabel = builder.get("status_label", Label)!;
  const runningCounterLabel = builder.get("running_counter_label", Label)!;
  const updateAvailableLabel = builder.get("update_available_label", Label)!;
  const statusBox = builder.get("status_box", Box)!;
  const actionBox = builder.get("action_box", Box)!;

  const installBtn = builder.get("install_btn", Button)!;
  const runBtn = builder.get("run_btn", Button)!;
  const runInTerminalBtn = builder.get("run_in_terminal_btn", Button)!;
  const killBtn = builder.get("kill_btn", Button)!;
  const cancelBtn = builder.get("cancel_btn", Button)!;
  const moreBtn = builder.get("more_btn", MenuButton)!;
  const morePopover = builder.get("more_popover", Popover)!;
  const updateBtn = builder.get("update_btn", Button)!;
  const reinstallBtn = builder.get("reinstall_btn", Button)!;
  const changelogBtn = builder.get("changelog_btn", Button)!;
  const removeBtn = builder.get("remove_btn", Button)!;

  const setSensitive = (sensitive: boolean) => {
    installBtn.setSensitive(sensitive);
    removeBtn.setSensitive(sensitive);
    updateBtn.setSensitive(sensitive);
    reinstallBtn.setSensitive(sensitive);
    runBtn.setSensitive(sensitive);
    runInTerminalBtn.setSensitive(sensitive);
    killBtn.setSensitive(sensitive);
    changelogBtn.setSensitive(sensitive);
  };

  const updateStatusLabel = (text: string) => {
    statusLabel.setText(text);
  };

  const setGroupState = (sensitive: boolean, status?: string) => {
    for (const row of recipeRows) {
      if (
        row.name === recipe.name ||
        (recipe._group && row.group === recipe._group)
      ) {
        row.setSensitive(sensitive);
        if (status) {
          row.updateStatusLabel(status);
        }
      }
    }
  };

  nameLabel.setMarkup(recipe.name);
  groups.nameGroup.addWidget(nameLabel);
  groups.versionGroup.addWidget(versionLabel);
  groups.latestVersionGroup.addWidget(latestVersionLabel);
  groups.statusGroup.addWidget(statusBox);
  groups.actionsGroup.addWidget(actionBox);

  let rowAbortController: AbortController | null = null;

  const checkUpdate = async () => {
    try {
      const info = await chef.checkUpdate(recipe.name);
      if (info.latestVersion) {
        latestVersionLabel.setText(info.latestVersion);
        latestVersionLabel.removeCssClass("dim-label");
      } else {
        latestVersionLabel.setText("-");
      }

      const installed = chef.isInstalled(recipe.name);
      const hasUpdate = !!(installed && info.needsUpdate);
      onStatusChanged(installed, hasUpdate);

      if (installed) {
        const hasLatest = info.latestVersion && info.latestVersion !== "-";
        if (info.needsUpdate) {
          updateAvailableLabel.setText("✨");
          updateBtn.addCssClass("success");
          updateBtn.setLabel("Update");
          updateBtn.setVisible(true);
          reinstallBtn.setVisible(false);
        } else if (
          hasLatest && info.currentVersion &&
          info.currentVersion === info.latestVersion
        ) {
          updateAvailableLabel.setText("  ");
          updateBtn.removeCssClass("success");
          updateBtn.setVisible(false);
          reinstallBtn.setVisible(true);
        } else if (hasLatest) {
          updateAvailableLabel.setText("  ");
          updateBtn.removeCssClass("success");
          updateBtn.setVisible(false);
          reinstallBtn.setVisible(true);
        } else {
          updateAvailableLabel.setText("  ");
          updateBtn.removeCssClass("success");
          updateBtn.setVisible(false);
          reinstallBtn.setVisible(false);
        }
      }
    } catch (e) {
      console.error(`Failed to check update for ${recipe.name}:`, e);
      latestVersionLabel.setText("Error");
    }
  };

  let runningCount = 0;
  const updateRunningStatus = async (running: boolean) => {
    if (running) {
      runningCount++;
    } else {
      runningCount = Math.max(0, runningCount - 1);
    }

    const isRunning = runningCount > 0;
    if (isRunning) {
      statusLabel.setText("Running");
      statusLabel.addCssClass("success");
      runningCounterLabel.setText(`(${runningCount})`);
    } else {
      runningCounterLabel.setText("");
      await updateStatus();
    }
    await updateButtons();
  };

  const updateStatus = async () => {
    const installed = await chef.isInstalled(recipe.name);
    statusLabel.setText(installed ? "Installed" : "Not Installed");
    const version = chef.getVersion(recipe.name);
    versionLabel.setText(version || "-");

    onStatusChanged(installed, false);

    if (installed) {
      statusLabel.addCssClass("success");
      statusLabel.removeCssClass("dim-label");
    } else {
      statusLabel.addCssClass("dim-label");
      statusLabel.removeCssClass("success");
      updateAvailableLabel.setText("  ");
      updateBtn.removeCssClass("success");
      updateBtn.setVisible(false);
      reinstallBtn.setVisible(false);
    }
    // Always check for latest version regardless of installation status
    await checkUpdate();
  };
  updateStatus();

  const updateButtons = async () => {
    const installed = await chef.isInstalled(recipe.name);
    const isRunning = runningCount > 0;

    installBtn.setVisible(!installed);
    runBtn.setVisible(installed);
    runInTerminalBtn.setVisible(installed);
    killBtn.setVisible(isRunning);

    // updateBtn visibility is handled in checkUpdate but we also need to respect isRunning
    if (isRunning) {
      updateBtn.setVisible(false);
      reinstallBtn.setVisible(false);
      removeBtn.setVisible(false);
    } else {
      // If not running, checkUpdate will have set visibility for updateBtn/reinstallBtn
      removeBtn.setVisible(installed);
    }

    changelogBtn.setVisible(!!recipe.changeLog);

    moreBtn.setVisible(
      (installed && !isRunning) || (!!recipe.changeLog),
    );
  };
  updateButtons();

  installBtn.onClick(async () => {
    setGroupState(false, "Installing...");
    installBtn.setLabel("Installing...");
    statusLabel.removeCssClass("success");
    cancelBtn.setVisible(true);
    rowAbortController = new AbortController();
    try {
      await chef.installOrUpdate(recipe.name, {
        signal: rowAbortController.signal,
      });
      await refreshList(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        console.log(`Installation of ${recipe.name} cancelled`);
      } else {
        console.error(e);
        installBtn.setLabel("Failed");
      }
      // Reset status on error or cancel
      await updateStatus();
      await updateButtons();
    } finally {
      installBtn.setLabel("Install");
      setGroupState(true);
      cancelBtn.setVisible(false);
      rowAbortController = null;
    }
  });

  removeBtn.onClick(async () => {
    morePopover.popdown();
    setGroupState(false, "Removing...");
    statusLabel.removeCssClass("success");
    cancelBtn.setVisible(true);
    rowAbortController = new AbortController();
    try {
      await chef.uninstall(recipe.name, { signal: rowAbortController.signal });
      await refreshList(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        console.log(`Removal of ${recipe.name} cancelled`);
      } else {
        console.error(e);
      }
      await updateStatus();
      await updateButtons();
    } finally {
      setGroupState(true);
      cancelBtn.setVisible(false);
      rowAbortController = null;
    }
  });

  const onUpdateOrReinstall = async (force: boolean) => {
    const isReinstall = force;
    const btn = isReinstall ? reinstallBtn : updateBtn;
    if (isReinstall) {
      morePopover.popdown();
    }
    const actionText = isReinstall ? "Reinstalling..." : "Updating...";
    setGroupState(false, actionText);
    const oldLabel = btn.getLabel();
    btn.setLabel(actionText);
    statusLabel.removeCssClass("success");
    cancelBtn.setVisible(true);
    rowAbortController = new AbortController();
    try {
      await chef.installOrUpdate(recipe.name, {
        force,
        signal: rowAbortController.signal,
      });
      await refreshList(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        console.log(
          `${isReinstall ? "Reinstall" : "Update"} of ${recipe.name} cancelled`,
        );
      } else {
        console.error(e);
      }
      // Reset status on error or cancel
      await updateStatus();
      await updateButtons();
    } finally {
      btn.setLabel(oldLabel);
      setGroupState(true);
      cancelBtn.setVisible(false);
      rowAbortController = null;
    }
  };

  updateBtn.onClick(() => onUpdateOrReinstall(false));
  reinstallBtn.onClick(() => onUpdateOrReinstall(true));

  cancelBtn.onClick(() => {
    if (rowAbortController) {
      rowAbortController.abort();
    }
  });

  runBtn.onClick(async () => {
    try {
      await chef.runBin(recipe.name, []);
    } catch (e) {
      console.error(`Failed to run ${recipe.name}:`, e);
    }
  });

  runInTerminalBtn.onClick(async () => {
    try {
      await chef.runInTerminal(recipe.name, []);
    } catch (e) {
      console.error(`Failed to run ${recipe.name} in terminal:`, e);
    }
  });

  killBtn.onClick(() => {
    chef.killAll(recipe.name);
  });

  changelogBtn.onClick(() => {
    morePopover.popdown();
    const version = chef.getVersion(recipe.name);
    if (recipe.changeLog && version) {
      const url = recipe.changeLog({ latestVersion: version });
      console.log(`Opening changelog: ${url}`);
      const command = Deno.build.os === "windows"
        ? "start"
        : Deno.build.os === "darwin"
        ? "open"
        : "xdg-open";
      new Deno.Command(command, { args: [url] }).spawn();
    }
  });

  return { row, setSensitive, updateRunningStatus, updateStatusLabel };
}
