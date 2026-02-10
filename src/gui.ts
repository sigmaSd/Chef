import {
  Align,
  Application,
  ApplicationWindow,
  Box,
  Builder,
  Button,
  Entry,
  Grid,
  Label,
  ListBox,
  ListBoxRow,
  Orientation,
  Popover,
  ProgressBar,
  SizeGroup,
  SizeGroupMode,
} from "@sigmasd/gtk/gtk4";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import type { ChefInternal } from "./chef-internal.ts";
import type { Recipe } from "../mod.ts";
import { setStatusListener } from "./dax_wrapper.ts";

export async function startGui(chef: ChefInternal) {
  const app = new Application("io.github.sigmasd.chef", 0);
  const eventLoop = new EventLoop();

  app.onActivate(() => {
    const builder = new Builder();
    const uiPath = new URL("./gui.ui", import.meta.url).pathname;
    builder.addFromFile(uiPath);

    const window = builder.get("window", ApplicationWindow)!;
    const versionLabel = builder.get("version_label", Label)!;
    const updateAllBtn = builder.get("update_all_btn", Button)!;
    const editRecipesBtn = builder.get("edit_recipes_btn", Button)!;
    const cancelBtn = builder.get("cancel_btn", Button)!;
    const listBox = builder.get("list_box", ListBox)!;
    const editorEntry = builder.get("editor_entry", Entry)!;
    const terminalEntry = builder.get("terminal_entry", Entry)!;
    const saveSettingsBtn = builder.get("save_settings_btn", Button)!;
    const statusLabel = builder.get("status_label", Label)!;
    const progressBar = builder.get("progress_bar", ProgressBar)!;

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

    const nameGroup = new SizeGroup(SizeGroupMode.HORIZONTAL);
    const versionGroup = new SizeGroup(SizeGroupMode.HORIZONTAL);
    const latestVersionGroup = new SizeGroup(SizeGroupMode.HORIZONTAL);
    const statusGroup = new SizeGroup(SizeGroupMode.HORIZONTAL);
    const actionsGroup = new SizeGroup(SizeGroupMode.HORIZONTAL);

    const createHeader = () => {
      const row = new ListBoxRow();
      row.setSensitive(false);
      row.addCssClass("header");
      const grid = new Grid();
      grid.setColumnSpacing(20);
      grid.setMarginTop(10);
      grid.setMarginBottom(10);
      grid.setMarginStart(10);
      grid.setMarginEnd(10);

      const nameLabel = new Label("Name");
      nameLabel.setHalign(Align.START);
      nameLabel.addCssClass("bold");
      nameGroup.addWidget(nameLabel);
      grid.attach(nameLabel, 0, 0, 1, 1);

      const versionLabel = new Label("Installed");
      versionLabel.setHalign(Align.START);
      versionLabel.addCssClass("bold");
      versionLabel.setProperty("width-chars", 12);
      versionGroup.addWidget(versionLabel);
      grid.attach(versionLabel, 1, 0, 1, 1);

      const latestVersionLabel = new Label("Latest");
      latestVersionLabel.setHalign(Align.START);
      latestVersionLabel.addCssClass("bold");
      latestVersionLabel.setProperty("width-chars", 12);
      latestVersionGroup.addWidget(latestVersionLabel);
      grid.attach(latestVersionLabel, 2, 0, 1, 1);

      const statusLabel = new Label("Status");
      statusLabel.setHalign(Align.START);
      statusLabel.addCssClass("bold");
      statusGroup.addWidget(statusLabel);
      grid.attach(statusLabel, 3, 0, 1, 1);

      const actionsLabel = new Label("Actions");
      actionsLabel.setHalign(Align.START);
      actionsLabel.addCssClass("bold");
      actionsGroup.addWidget(actionsLabel);
      grid.attach(actionsLabel, 4, 0, 1, 1);

      row.setChild(grid);
      return row;
    };

    let abortController: AbortController | null = null;
    const recipeRows: {
      setSensitive: (sensitive: boolean) => void;
      updateRunningStatus: (running: boolean) => void;
      name: string;
    }[] = [];

    const refreshList = () => {
      listBox.removeAll();
      recipeRows.length = 0;

      listBox.append(createHeader());

      for (const recipe of chef.recipes) {
        const { row, setSensitive, updateRunningStatus } = createRecipeRow(
          chef,
          recipe,
          {
            nameGroup,
            versionGroup,
            latestVersionGroup,
            statusGroup,
            actionsGroup,
          },
        );
        recipeRows.push({
          setSensitive,
          updateRunningStatus,
          name: recipe.name,
        });
        listBox.append(row);
      }
    };

    chef.setBinaryStatusListener((name, running) => {
      const row = recipeRows.find((r) => r.name === name);
      if (row) {
        row.updateRunningStatus(running);
      }
    });

    updateAllBtn.onClick(async () => {
      updateAllBtn.setSensitive(false);
      updateAllBtn.setLabel("Updating All...");
      cancelBtn.setVisible(true);
      recipeRows.forEach((r) => r.setSensitive(false));

      abortController = new AbortController();
      try {
        await chef.updateAll({ signal: abortController.signal });
        refreshList();
      } catch (e) {
        console.error(e);
      } finally {
        updateAllBtn.setSensitive(true);
        updateAllBtn.setLabel("Update All");
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
): {
  row: ListBoxRow;
  setSensitive: (sensitive: boolean) => void;
  updateRunningStatus: (running: boolean) => void;
} {
  const row = new ListBoxRow();
  const grid = new Grid();
  grid.setColumnSpacing(20);
  grid.setMarginTop(5);
  grid.setMarginBottom(5);
  grid.setMarginStart(10);
  grid.setMarginEnd(10);

  const nameLabel = new Label(recipe.name);
  nameLabel.setHalign(Align.START);
  groups.nameGroup.addWidget(nameLabel);
  grid.attach(nameLabel, 0, 0, 1, 1);

  const versionLabel = new Label("");
  versionLabel.setHalign(Align.START);
  versionLabel.setProperty("width-chars", 12);
  versionLabel.setEllipsize(3); // END
  groups.versionGroup.addWidget(versionLabel);
  grid.attach(versionLabel, 1, 0, 1, 1);

  const latestVersionLabel = new Label("Checking...");
  latestVersionLabel.setHalign(Align.START);
  latestVersionLabel.setProperty("width-chars", 12);
  latestVersionLabel.setEllipsize(3); // END
  latestVersionLabel.addCssClass("dim-label");
  groups.latestVersionGroup.addWidget(latestVersionLabel);
  grid.attach(latestVersionLabel, 2, 0, 1, 1);

  const statusBox = new Box(Orientation.HORIZONTAL, 5);
  statusBox.setHalign(Align.START);
  const statusLabel = new Label("");
  const runningCounterLabel = new Label("");
  runningCounterLabel.addCssClass("dim-label");

  const updateAvailableLabel = new Label("  ");
  updateAvailableLabel.addCssClass("warning");
  updateAvailableLabel.setHalign(Align.START);
  updateAvailableLabel.setTooltipText("Update available!");

  statusBox.append(statusLabel);
  statusBox.append(runningCounterLabel);
  statusBox.append(updateAvailableLabel);
  groups.statusGroup.addWidget(statusBox);
  grid.attach(statusBox, 3, 0, 1, 1);

  const actionBox = new Box(Orientation.HORIZONTAL, 5);
  actionBox.setHalign(Align.END);
  groups.actionsGroup.addWidget(actionBox);
  grid.attach(actionBox, 4, 0, 1, 1);

  const installBtn = new Button("Install");
  installBtn.addCssClass("suggested-action");

  const runBtn = new Button();
  runBtn.setIconName("media-playback-start-symbolic");
  runBtn.setTooltipText("Run");

  const runInTerminalBtn = new Button();
  runInTerminalBtn.setIconName("utilities-terminal-symbolic");
  runInTerminalBtn.setTooltipText("Run in Terminal");

  const killBtn = new Button();
  killBtn.setIconName("process-stop-symbolic");
  killBtn.addCssClass("destructive-action");
  killBtn.setTooltipText("Kill All Instances");
  killBtn.setVisible(false);

  const cancelBtn = new Button();
  cancelBtn.setIconName("process-stop-symbolic");
  cancelBtn.setVisible(false);
  cancelBtn.setTooltipText("Cancel");

  const moreBtn = new Button();
  moreBtn.setIconName("view-more-symbolic");
  moreBtn.setTooltipText("More Actions");

  const morePopover = new Popover();
  morePopover.setParent(moreBtn);
  const moreBox = new Box(Orientation.VERTICAL, 5);
  moreBox.setMarginTop(8);
  moreBox.setMarginBottom(8);
  moreBox.setMarginStart(8);
  moreBox.setMarginEnd(8);

  const updateBtn = new Button("Update");
  const changelogBtn = new Button("Changelog");
  const removeBtn = new Button("Remove");
  removeBtn.addCssClass("destructive-action");

  moreBox.append(updateBtn);
  moreBox.append(changelogBtn);
  moreBox.append(removeBtn);
  morePopover.setChild(moreBox);

  moreBtn.onClick(() => {
    morePopover.popup();
  });

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

      if (chef.isInstalled(recipe.name)) {
        if (info.needsUpdate) {
          updateAvailableLabel.setText("✨");
          updateBtn.addCssClass("success");
          updateBtn.setLabel("Update");
        } else if (
          info.currentVersion && info.latestVersion &&
          info.currentVersion === info.latestVersion
        ) {
          updateAvailableLabel.setText("  ");
          updateBtn.removeCssClass("success");
          updateBtn.setLabel("Reinstall");
        } else {
          updateAvailableLabel.setText("  ");
          updateBtn.removeCssClass("success");
          updateBtn.setLabel("Update");
        }
      }
    } catch (e) {
      console.error(`Failed to check update for ${recipe.name}:`, e);
      latestVersionLabel.setText("Error");
    }
  };

  let runningCount = 0;
  const updateRunningStatus = (running: boolean) => {
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
      updateStatus();
    }
    updateButtons();
  };

  const updateStatus = () => {
    const installed = chef.isInstalled(recipe.name);
    statusLabel.setText(installed ? "Installed" : "Not Installed");
    const version = chef.getVersion(recipe.name);
    versionLabel.setText(version || "-");

    if (installed) {
      statusLabel.addCssClass("success");
      statusLabel.removeCssClass("dim-label");
    } else {
      statusLabel.addCssClass("dim-label");
      statusLabel.removeCssClass("success");
      updateAvailableLabel.setText("  ");
      updateBtn.removeCssClass("success");
    }
    // Always check for latest version regardless of installation status
    checkUpdate();
  };
  updateStatus();

  const updateButtons = () => {
    const installed = chef.isInstalled(recipe.name);
    const isRunning = runningCount > 0;

    installBtn.setVisible(!installed);
    runBtn.setVisible(installed);
    runInTerminalBtn.setVisible(installed);
    killBtn.setVisible(isRunning);

    updateBtn.setVisible(installed && !isRunning);
    removeBtn.setVisible(installed && !isRunning);
    changelogBtn.setVisible(!!recipe.changeLog);

    moreBtn.setVisible(
      (installed && !isRunning) || (!!recipe.changeLog),
    );
  };
  updateButtons();

  installBtn.onClick(async () => {
    installBtn.setSensitive(false);
    installBtn.setLabel("Installing...");
    cancelBtn.setVisible(true);
    rowAbortController = new AbortController();
    try {
      await chef.installOrUpdate(recipe.name, {
        signal: rowAbortController.signal,
      });
      updateStatus();
      updateButtons();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        console.log(`Installation of ${recipe.name} cancelled`);
      } else {
        console.error(e);
        installBtn.setLabel("Failed");
      }
    } finally {
      installBtn.setSensitive(true);
      installBtn.setLabel("Install");
      cancelBtn.setVisible(false);
      rowAbortController = null;
    }
  });

  removeBtn.onClick(async () => {
    morePopover.popdown();
    removeBtn.setSensitive(false);
    try {
      await chef.uninstall(recipe.name);
      updateStatus();
      updateButtons();
    } catch (e) {
      console.error(e);
    } finally {
      removeBtn.setSensitive(true);
    }
  });

  updateBtn.onClick(async () => {
    morePopover.popdown();
    const isReinstall = updateBtn.getLabel() === "Reinstall";
    updateBtn.setSensitive(false);
    updateBtn.setLabel(isReinstall ? "Reinstalling..." : "Updating...");
    cancelBtn.setVisible(true);
    rowAbortController = new AbortController();
    try {
      await chef.installOrUpdate(recipe.name, {
        force: true,
        signal: rowAbortController.signal,
      });
      updateStatus();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        console.log(
          `${isReinstall ? "Reinstall" : "Update"} of ${recipe.name} cancelled`,
        );
      } else {
        console.error(e);
      }
      updateBtn.setLabel(isReinstall ? "Reinstall" : "Update");
    } finally {
      updateBtn.setSensitive(true);
      cancelBtn.setVisible(false);
      rowAbortController = null;
    }
  });

  cancelBtn.onClick(() => {
    if (rowAbortController) {
      rowAbortController.abort();
    }
  });

  runBtn.onClick(() => {
    chef.runBin(recipe.name, []);
  });

  runInTerminalBtn.onClick(() => {
    chef.runInTerminal(recipe.name, []);
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

  actionBox.append(killBtn);
  actionBox.append(runBtn);
  actionBox.append(runInTerminalBtn);
  actionBox.append(installBtn);
  actionBox.append(cancelBtn);
  actionBox.append(moreBtn);

  row.setChild(grid);

  const setSensitive = (sensitive: boolean) => {
    installBtn.setSensitive(sensitive);
    removeBtn.setSensitive(sensitive);
    updateBtn.setSensitive(sensitive);
    runBtn.setSensitive(sensitive);
    runInTerminalBtn.setSensitive(sensitive);
    killBtn.setSensitive(sensitive);
    changelogBtn.setSensitive(sensitive);
  };

  return { row, setSensitive, updateRunningStatus };
}
