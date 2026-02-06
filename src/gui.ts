import {
  Align,
  Application,
  ApplicationWindow,
  Box,
  Button,
  Grid,
  Label,
  ListBox,
  ListBoxRow,
  Orientation,
  ProgressBar,
  ScrolledWindow,
  SizeGroup,
  SizeGroupMode,
} from "@sigmasd/gtk/gtk4";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import type { ChefInternal } from "./chef-internal.ts";
import type { Recipe } from "../mod.ts";
import { setStatusListener } from "./dax_wrapper.ts";

export async function startGui(chef: ChefInternal) {
  const app = new Application("com.github.sigmasd.chef", 0);
  const eventLoop = new EventLoop();

  app.onActivate(() => {
    const window = new ApplicationWindow(app);
    window.setTitle("Chef");
    window.setDefaultSize(800, 600);

    const mainBox = new Box(Orientation.VERTICAL, 10);
    mainBox.setMarginTop(10);
    mainBox.setMarginBottom(10);
    mainBox.setMarginStart(10);
    mainBox.setMarginEnd(10);

    const headerBox = new Box(Orientation.HORIZONTAL, 10);
    const titleLabel = new Label("Chef - Personal Package Manager");
    titleLabel.addCssClass("title-1");
    titleLabel.setHexpand(true);
    titleLabel.setHalign(Align.START);
    headerBox.append(titleLabel);

    const updateAllBtn = new Button("Update All");
    updateAllBtn.addCssClass("suggested-action");

    const editRecipesBtn = new Button("Edit Recipes");

    const cancelBtn = new Button("Cancel");
    cancelBtn.setVisible(false);

    headerBox.append(updateAllBtn);
    headerBox.append(editRecipesBtn);
    headerBox.append(cancelBtn);
    mainBox.append(headerBox);

    const scrolledWindow = new ScrolledWindow();
    scrolledWindow.setVexpand(true);
    scrolledWindow.setHexpand(true);

    // Set a border around the list
    scrolledWindow.addCssClass("frame");

    const listBox = new ListBox();
    listBox.setSelectionMode(0); // NONE
    listBox.setShowSeparators(true);

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
    const recipeRows: { setSensitive: (sensitive: boolean) => void }[] = [];

    const refreshList = () => {
      listBox.removeAll();
      recipeRows.length = 0;

      listBox.append(createHeader());

      for (const recipe of chef.recipes) {
        const { row, setSensitive } = createRecipeRow(chef, recipe, {
          nameGroup,
          versionGroup,
          latestVersionGroup,
          statusGroup,
          actionsGroup,
        });
        recipeRows.push({ setSensitive });
        listBox.append(row);
      }
    };

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
        const command = Deno.build.os === "windows"
          ? "start"
          : Deno.build.os === "darwin"
          ? "open"
          : "xdg-open";
        new Deno.Command(command, { args: [chefPath] }).spawn();
      }
    });

    cancelBtn.onClick(() => {
      if (abortController) {
        abortController.abort();
      }
    });

    // Initial populate
    refreshList();

    scrolledWindow.setChild(listBox);
    mainBox.append(scrolledWindow);

    const statusBox = new Box(Orientation.HORIZONTAL, 10);
    statusBox.setMarginTop(5);
    const statusPrefix = new Label("Status:");
    statusPrefix.addCssClass("dim-label");
    const statusLabel = new Label("Idle");
    statusLabel.setHalign(Align.START);
    statusLabel.setEllipsize(3); // END
    statusBox.append(statusPrefix);
    statusBox.append(statusLabel);

    const progressBar = new ProgressBar();
    progressBar.setHexpand(true);
    progressBar.setVisible(false);
    statusBox.append(progressBar);

    mainBox.append(statusBox);

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

    window.setChild(mainBox);
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
): { row: ListBoxRow; setSensitive: (sensitive: boolean) => void } {
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
  const updateAvailableLabel = new Label("  ");
  updateAvailableLabel.addCssClass("warning");
  updateAvailableLabel.setHalign(Align.START);
  updateAvailableLabel.setTooltipText("Update available!");

  statusBox.append(statusLabel);
  statusBox.append(updateAvailableLabel);
  groups.statusGroup.addWidget(statusBox);
  grid.attach(statusBox, 3, 0, 1, 1);

  const actionBox = new Box(Orientation.HORIZONTAL, 5);
  groups.actionsGroup.addWidget(actionBox);
  grid.attach(actionBox, 4, 0, 1, 1);

  const installBtn = new Button("Install");
  installBtn.addCssClass("suggested-action");

  const uninstallBtn = new Button();
  uninstallBtn.setIconName("user-trash-symbolic");
  uninstallBtn.addCssClass("flat");
  uninstallBtn.addCssClass("destructive-action");
  uninstallBtn.setTooltipText("Uninstall");

  const updateBtn = new Button("Update");

  const cancelBtn = new Button();
  cancelBtn.setIconName("process-stop-symbolic");
  cancelBtn.addCssClass("flat");
  cancelBtn.setVisible(false);
  cancelBtn.setTooltipText("Cancel");

  const runBtn = new Button();
  runBtn.setIconName("media-playback-start-symbolic");
  runBtn.addCssClass("flat");
  runBtn.setTooltipText("Run");

  const changelogBtn = new Button();
  changelogBtn.setIconName("help-about-symbolic");
  changelogBtn.addCssClass("flat");
  changelogBtn.setTooltipText("Changelog");

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

      if (chef.isInstalled(recipe.name) && info.needsUpdate) {
        updateAvailableLabel.setText("✨");
        updateBtn.addCssClass("success");
      } else {
        updateAvailableLabel.setText("  ");
        updateBtn.removeCssClass("success");
      }
    } catch (e) {
      console.error(`Failed to check update for ${recipe.name}:`, e);
      latestVersionLabel.setText("Error");
    }
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
    installBtn.setVisible(!installed);
    uninstallBtn.setVisible(installed);
    updateBtn.setVisible(installed);
    runBtn.setVisible(installed);
    changelogBtn.setVisible(!!recipe.changeLog);
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

  uninstallBtn.onClick(async () => {
    uninstallBtn.setSensitive(false);
    try {
      await chef.uninstall(recipe.name);
      updateStatus();
      updateButtons();
    } catch (e) {
      console.error(e);
    } finally {
      uninstallBtn.setSensitive(true);
    }
  });

  updateBtn.onClick(async () => {
    updateBtn.setSensitive(false);
    updateBtn.setLabel("Updating...");
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
        console.log(`Update of ${recipe.name} cancelled`);
      } else {
        console.error(e);
      }
    } finally {
      updateBtn.setSensitive(true);
      updateBtn.setLabel("Update");
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

  changelogBtn.onClick(() => {
    const version = chef.getVersion(recipe.name);
    if (recipe.changeLog && version) {
      const url = recipe.changeLog({ latestVersion: version });
      // In a real GTK app we might use Gio.AppInfo.launch_default_for_uri
      // For now, we can try to use dax to open it or just log it
      console.log(`Opening changelog: ${url}`);
      // Try to open with system default browser
      const command = Deno.build.os === "windows"
        ? "start"
        : Deno.build.os === "darwin"
        ? "open"
        : "xdg-open";
      new Deno.Command(command, { args: [url] }).spawn();
    }
  });

  actionBox.append(installBtn);
  actionBox.append(updateBtn);
  actionBox.append(cancelBtn);
  actionBox.append(uninstallBtn);
  actionBox.append(runBtn);
  actionBox.append(changelogBtn);

  row.setChild(grid);

  const setSensitive = (sensitive: boolean) => {
    installBtn.setSensitive(sensitive);
    uninstallBtn.setSensitive(sensitive);
    updateBtn.setSensitive(sensitive);
    runBtn.setSensitive(sensitive);
    changelogBtn.setSensitive(sensitive);
    if (!sensitive && rowAbortController) {
      // If we are globally disabling, we might want to keep the cancel button enabled
      // but usually updateAll handles its own cancellation globally.
    }
  };

  return { row, setSensitive };
}
