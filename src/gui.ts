import {
  Align,
  Application,
  ApplicationWindow,
  Box,
  Builder,
  Button,
  ColumnView,
  Entry,
  Label,
  Orientation,
  Popover,
  ProgressBar,
  SingleSelection,
} from "@sigmasd/gtk/gtk4";
import { ListStore } from "@sigmasd/gtk/gio";
import { G_TYPE_OBJECT, GObject } from "@sigmasd/gtk/gobject";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import type { ChefInternal } from "./chef-internal.ts";
import type { Recipe } from "../mod.ts";
import { setStatusListener } from "./dax_wrapper.ts";

class RecipeItem extends GObject {
  recipe: Recipe;
  runningCount = 0;
  installed = false;
  version: string | null = null;
  latestVersion: string | null = null;
  needsUpdate = false;
  rowAbortController: AbortController | null = null;
  sensitive = true;

  // UI elements references to update them easily
  versionLabel?: Label;
  latestVersionLabel?: Label;
  statusLabel?: Label;
  runningCounterLabel?: Label;
  updateAvailableLabel?: Label;

  installBtn?: Button;
  runBtn?: Button;
  runInTerminalBtn?: Button;
  killBtn?: Button;
  cancelBtn?: Button;
  moreBtn?: Button;
  updateBtn?: Button;
  removeBtn?: Button;
  changelogBtn?: Button;
  morePopover?: Popover;

  constructor(recipe: Recipe) {
    super();
    this.recipe = recipe;
  }
}

class StatusBox extends Box {
  statusLabel = new Label("");
  runningCounterLabel = new Label("");
  updateAvailableLabel = new Label("  ");

  constructor() {
    super(Orientation.HORIZONTAL, 5);
    this.setHalign(Align.START);
    this.setMarginStart(10);
    this.setMarginEnd(10);

    this.runningCounterLabel.addCssClass("dim-label");
    this.updateAvailableLabel.addCssClass("warning");
    this.updateAvailableLabel.setHalign(Align.START);
    this.updateAvailableLabel.setTooltipText("Update available!");

    this.append(this.statusLabel);
    this.append(this.runningCounterLabel);
    this.append(this.updateAvailableLabel);
  }
}

class ActionBox extends Box {
  installBtn = new Button("Install");
  runBtn = new Button();
  runInTerminalBtn = new Button();
  killBtn = new Button();
  cancelBtn = new Button();
  moreBtn = new Button();
  updateBtn = new Button("Update");
  changelogBtn = new Button("Changelog");
  removeBtn = new Button("Remove");
  morePopover = new Popover();

  // The item currently "bound" to this UI component
  boundItem?: RecipeItem;

  constructor(chef: ChefInternal) {
    super(Orientation.HORIZONTAL, 5);
    this.setHalign(Align.END);
    this.setMarginStart(10);
    this.setMarginEnd(10);

    this.installBtn.addCssClass("suggested-action");
    this.runBtn.setIconName("media-playback-start-symbolic");
    this.runBtn.setTooltipText("Run");
    this.runInTerminalBtn.setIconName("utilities-terminal-symbolic");
    this.runInTerminalBtn.setTooltipText("Run in Terminal");
    this.killBtn.setIconName("process-stop-symbolic");
    this.killBtn.addCssClass("destructive-action");
    this.killBtn.setTooltipText("Kill All Instances");
    this.killBtn.setVisible(false);
    this.cancelBtn.setIconName("process-stop-symbolic");
    this.cancelBtn.setVisible(false);
    this.cancelBtn.setTooltipText("Cancel");
    this.moreBtn.setIconName("view-more-symbolic");
    this.moreBtn.setTooltipText("More Actions");

    this.morePopover.setParent(this.moreBtn);
    const moreBox = new Box(Orientation.VERTICAL, 5);
    this.removeBtn.addCssClass("destructive-action");
    moreBox.append(this.updateBtn);
    moreBox.append(this.changelogBtn);
    moreBox.append(this.removeBtn);
    this.morePopover.setChild(moreBox);

    // Setup listeners ONCE. They use this.boundItem to act on the correct data.
    this.moreBtn.onClick(() => this.morePopover.popup());

    this.installBtn.onClick(async () => {
      if (this.boundItem) await handleInstall(chef, this.boundItem);
    });
    this.removeBtn.onClick(async () => {
      if (this.boundItem) await handleRemove(chef, this.boundItem);
    });
    this.updateBtn.onClick(async () => {
      if (this.boundItem) await handleUpdate(chef, this.boundItem);
    });
    this.cancelBtn.onClick(() => {
      if (this.boundItem?.rowAbortController) {
        this.boundItem.rowAbortController.abort();
      }
    });
    this.runBtn.onClick(() => {
      if (this.boundItem) chef.runBin(this.boundItem.recipe.name, []);
    });
    this.runInTerminalBtn.onClick(() => {
      if (this.boundItem) chef.runInTerminal(this.boundItem.recipe.name, []);
    });
    this.killBtn.onClick(() => {
      if (this.boundItem) chef.killAll(this.boundItem.recipe.name);
    });
    this.changelogBtn.onClick(() => {
      if (this.boundItem) handleChangelog(chef, this.boundItem);
    });

    this.append(this.killBtn);
    this.append(this.runBtn);
    this.append(this.runInTerminalBtn);
    this.append(this.installBtn);
    this.append(this.cancelBtn);
    this.append(this.moreBtn);
  }
}

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
    const columnView = builder.get("column_view", ColumnView)!;
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
    });

    const store = new ListStore(G_TYPE_OBJECT);
    const selection = new SingleSelection(store);
    columnView.model = selection;

    // Name Column
    columnView.addColumn<RecipeItem, Label>({
      title: "Name",
      setup: () => {
        const label = new Label("");
        label.setHalign(Align.START);
        label.setMarginStart(10);
        label.setMarginEnd(10);
        return label;
      },
      bind: (item, label) => {
        label.setText(item.recipe.name);
      },
    });

    // Installed Column
    columnView.addColumn<RecipeItem, Label>({
      title: "Installed",
      setup: () => {
        const label = new Label("");
        label.setHalign(Align.START);
        label.setMarginStart(10);
        label.setMarginEnd(10);
        label.setProperty("width-chars", 12);
        label.setEllipsize(3); // END
        return label;
      },
      bind: (item, label) => {
        item.versionLabel = label;
        updateItemStatus(chef, item);
      },
      unbind: (item, _label) => {
        item.versionLabel = undefined;
      },
    });

    // Latest Column
    columnView.addColumn<RecipeItem, Label>({
      title: "Latest",
      setup: () => {
        const label = new Label("");
        label.setHalign(Align.START);
        label.setMarginStart(10);
        label.setMarginEnd(10);
        label.setProperty("width-chars", 12);
        label.setEllipsize(3); // END
        return label;
      },
      bind: (item, label) => {
        item.latestVersionLabel = label;
        updateItemStatus(chef, item);
      },
      unbind: (item, _label) => {
        item.latestVersionLabel = undefined;
      },
    });

    // Status Column
    columnView.addColumn<RecipeItem, StatusBox>({
      title: "Status",
      setup: () => new StatusBox(),
      bind: (item, box) => {
        item.statusLabel = box.statusLabel;
        item.runningCounterLabel = box.runningCounterLabel;
        item.updateAvailableLabel = box.updateAvailableLabel;
        updateItemStatus(chef, item);
      },
      unbind: (item, _box) => {
        item.statusLabel = undefined;
        item.runningCounterLabel = undefined;
        item.updateAvailableLabel = undefined;
      },
    });

    // Actions Column
    columnView.addColumn<RecipeItem, ActionBox>({
      title: "Actions",
      expand: true,
      setup: () => new ActionBox(chef),
      bind: (item, box) => {
        box.boundItem = item; // IMPORTANT: Link the box to this item

        item.installBtn = box.installBtn;
        item.runBtn = box.runBtn;
        item.runInTerminalBtn = box.runInTerminalBtn;
        item.killBtn = box.killBtn;
        item.cancelBtn = box.cancelBtn;
        item.moreBtn = box.moreBtn;
        item.updateBtn = box.updateBtn;
        item.removeBtn = box.removeBtn;
        item.changelogBtn = box.changelogBtn;
        item.morePopover = box.morePopover;

        updateItemStatus(chef, item);
      },
      unbind: (item, box) => {
        box.boundItem = undefined; // IMPORTANT: Unlink

        item.installBtn = undefined;
        item.runBtn = undefined;
        item.runInTerminalBtn = undefined;
        item.killBtn = undefined;
        item.cancelBtn = undefined;
        item.moreBtn = undefined;
        item.updateBtn = undefined;
        item.removeBtn = undefined;
        item.changelogBtn = undefined;
        item.morePopover = undefined;
      },
    });

    let abortController: AbortController | null = null;
    const recipeItems: RecipeItem[] = [];

    const refreshList = () => {
      store.removeAll();
      recipeItems.length = 0;

      for (const recipe of chef.recipes) {
        const item = new RecipeItem(recipe);
        recipeItems.push(item);
        store.append(item);
      }
    };

    chef.setBinaryStatusListener((name, running) => {
      const item = recipeItems.find((r) => r.recipe.name === name);
      if (item) {
        updateItemRunningStatus(chef, item, running);
      }
    });

    updateAllBtn.onClick(async () => {
      updateAllBtn.setSensitive(false);
      updateAllBtn.setLabel("Updating All...");
      cancelBtn.setVisible(true);
      recipeItems.forEach((item) => {
        item.sensitive = false;
        updateItemButtons(item);
      });

      abortController = new AbortController();
      try {
        await chef.updateAll({ signal: abortController.signal });
        recipeItems.forEach((item) => updateItemStatus(chef, item));
      } catch (e) {
        console.error(e);
      } finally {
        updateAllBtn.setSensitive(true);
        updateAllBtn.setLabel("Update All");
        cancelBtn.setVisible(false);
        recipeItems.forEach((item) => {
          item.sensitive = true;
          updateItemButtons(item);
        });
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

async function checkItemUpdate(chef: ChefInternal, item: RecipeItem) {
  try {
    const info = await chef.checkUpdate(item.recipe.name);
    item.latestVersion = info.latestVersion || "-";
    item.needsUpdate = info.needsUpdate;

    if (item.latestVersionLabel) {
      item.latestVersionLabel.setText(item.latestVersion);
      if (info.latestVersion) {
        item.latestVersionLabel.removeCssClass("dim-label");
      }
    }

    if (item.updateBtn) {
      if (chef.isInstalled(item.recipe.name)) {
        if (info.needsUpdate) {
          if (item.updateAvailableLabel) {
            item.updateAvailableLabel.setText("✨");
          }
          item.updateBtn.addCssClass("success");
          item.updateBtn.setLabel("Update");
        } else if (
          info.currentVersion && info.latestVersion &&
          info.currentVersion === info.latestVersion
        ) {
          if (item.updateAvailableLabel) {
            item.updateAvailableLabel.setText("  ");
          }
          item.updateBtn.removeCssClass("success");
          item.updateBtn.setLabel("Reinstall");
        } else {
          if (item.updateAvailableLabel) {
            item.updateAvailableLabel.setText("  ");
          }
          item.updateBtn.removeCssClass("success");
          item.updateBtn.setLabel("Update");
        }
      }
    }
  } catch (e) {
    console.error(`Failed to check update for ${item.recipe.name}:`, e);
    if (item.latestVersionLabel) item.latestVersionLabel.setText("Error");
  }
}

function updateItemStatus(chef: ChefInternal, item: RecipeItem) {
  item.installed = chef.isInstalled(item.recipe.name);
  item.version = chef.getVersion(item.recipe.name) || "-";

  if (item.versionLabel) {
    item.versionLabel.setText(item.version);
  }

  if (item.statusLabel) {
    if (item.runningCount > 0) {
      item.statusLabel.setText("Running");
      item.statusLabel.addCssClass("success");
      if (item.runningCounterLabel) {
        item.runningCounterLabel.setText(`(${item.runningCount})`);
      }
    } else {
      item.statusLabel.setText(item.installed ? "Installed" : "Not Installed");
      if (item.runningCounterLabel) item.runningCounterLabel.setText("");

      if (item.installed) {
        item.statusLabel.addCssClass("success");
        item.statusLabel.removeCssClass("dim-label");
      } else {
        item.statusLabel.addCssClass("dim-label");
        item.statusLabel.removeCssClass("success");
        if (item.updateAvailableLabel) item.updateAvailableLabel.setText("  ");
        if (item.updateBtn) item.updateBtn.removeCssClass("success");
      }
    }
  }

  updateItemButtons(item);
  checkItemUpdate(chef, item);
}

function updateItemButtons(item: RecipeItem) {
  const isRunning = item.runningCount > 0;

  if (item.installBtn) item.installBtn.setVisible(!item.installed);
  if (item.runBtn) item.runBtn.setVisible(item.installed);
  if (item.runInTerminalBtn) item.runInTerminalBtn.setVisible(item.installed);
  if (item.killBtn) item.killBtn.setVisible(isRunning);

  if (item.updateBtn) item.updateBtn.setVisible(item.installed && !isRunning);
  if (item.removeBtn) item.removeBtn.setVisible(item.installed && !isRunning);
  if (item.changelogBtn) {
    item.changelogBtn.setVisible(!!item.recipe.changeLog);
  }

  if (item.moreBtn) {
    item.moreBtn.setVisible(
      (item.installed && !isRunning) || (!!item.recipe.changeLog),
    );
  }

  const sensitive = item.sensitive;
  if (item.installBtn) item.installBtn.setSensitive(sensitive);
  if (item.runBtn) item.runBtn.setSensitive(sensitive);
  if (item.runInTerminalBtn) item.runInTerminalBtn.setSensitive(sensitive);
  if (item.killBtn) item.killBtn.setSensitive(sensitive);
  if (item.updateBtn) item.updateBtn.setSensitive(sensitive);
  if (item.removeBtn) item.removeBtn.setSensitive(sensitive);
  if (item.changelogBtn) item.changelogBtn.setSensitive(sensitive);
}

function updateItemRunningStatus(
  chef: ChefInternal,
  item: RecipeItem,
  running: boolean,
) {
  if (running) {
    item.runningCount++;
  } else {
    item.runningCount = Math.max(0, item.runningCount - 1);
  }
  updateItemStatus(chef, item);
}

async function handleInstall(chef: ChefInternal, item: RecipeItem) {
  if (!item.installBtn) return;
  item.installBtn.setSensitive(false);
  item.installBtn.setLabel("Installing...");
  if (item.cancelBtn) item.cancelBtn.setVisible(true);
  item.rowAbortController = new AbortController();
  try {
    await chef.installOrUpdate(item.recipe.name, {
      signal: item.rowAbortController.signal,
    });
    updateItemStatus(chef, item);
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      console.log(`Installation of ${item.recipe.name} cancelled`);
    } else {
      console.error(e);
      if (item.installBtn) item.installBtn.setLabel("Failed");
    }
  } finally {
    if (item.installBtn) {
      item.installBtn.setSensitive(true);
      item.installBtn.setLabel("Install");
    }
    if (item.cancelBtn) item.cancelBtn.setVisible(false);
    item.rowAbortController = null;
  }
}

async function handleRemove(chef: ChefInternal, item: RecipeItem) {
  if (item.morePopover) item.morePopover.popdown();
  if (!item.removeBtn) return;
  item.removeBtn.setSensitive(false);
  try {
    await chef.uninstall(item.recipe.name);
    updateItemStatus(chef, item);
  } catch (e) {
    console.error(e);
  } finally {
    if (item.removeBtn) item.removeBtn.setSensitive(true);
  }
}

async function handleUpdate(chef: ChefInternal, item: RecipeItem) {
  if (item.morePopover) item.morePopover.popdown();
  if (!item.updateBtn) return;
  const isReinstall = item.updateBtn.getLabel() === "Reinstall";
  item.updateBtn.setSensitive(false);
  item.updateBtn.setLabel(isReinstall ? "Reinstalling..." : "Updating...");
  if (item.cancelBtn) item.cancelBtn.setVisible(true);
  item.rowAbortController = new AbortController();
  try {
    await chef.installOrUpdate(item.recipe.name, {
      force: true,
      signal: item.rowAbortController.signal,
    });
    updateItemStatus(chef, item);
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      console.log(
        `${
          isReinstall ? "Reinstall" : "Update"
        } of ${item.recipe.name} cancelled`,
      );
    } else {
      console.error(e);
    }
    if (item.updateBtn) {
      item.updateBtn.setLabel(isReinstall ? "Reinstall" : "Update");
    }
  } finally {
    if (item.updateBtn) item.updateBtn.setSensitive(true);
    if (item.cancelBtn) item.cancelBtn.setVisible(false);
    item.rowAbortController = null;
  }
}

function handleChangelog(chef: ChefInternal, item: RecipeItem) {
  if (item.morePopover) item.morePopover.popdown();
  const version = chef.getVersion(item.recipe.name);
  if (item.recipe.changeLog && version) {
    const url = item.recipe.changeLog({ latestVersion: version });
    console.log(`Opening changelog: ${url}`);
    const command = Deno.build.os === "windows"
      ? "start"
      : Deno.build.os === "darwin"
      ? "open"
      : "xdg-open";
    new Deno.Command(command, { args: [url] }).spawn();
  }
}
