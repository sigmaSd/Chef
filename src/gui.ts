import {
  Align,
  Application,
  ApplicationWindow,
  Box,
  Builder,
  Button,
  ColumnView,
  ColumnViewColumn,
  Entry,
  Label,
  ListItem,
  Orientation,
  Popover,
  ProgressBar,
  SignalListItemFactory,
  SingleSelection,
} from "@sigmasd/gtk/gtk4";
import { ListStore } from "@sigmasd/gtk/gio";
import { createGObject, G_TYPE_OBJECT, GObject } from "@sigmasd/gtk/gobject";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import type { ChefInternal } from "./chef-internal.ts";
import type { Recipe } from "../mod.ts";
import { setStatusListener } from "./dax_wrapper.ts";

const recipeItemMap = new Map<bigint, RecipeItem>();
const uiElementsMap = new Map<bigint, any>();

function getPtrValue(ptr: Deno.PointerValue): bigint {
  return ptr ? BigInt(Deno.UnsafePointer.value(ptr)) : 0n;
}

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
    const ptr = createGObject("GObject")!;
    super(ptr);
    this.recipe = recipe;
    recipeItemMap.set(getPtrValue(ptr), this);
  }
}

function getRecipeItem(obj: GObject | null): RecipeItem | undefined {
  if (!obj || !obj.ptr) return undefined;
  return recipeItemMap.get(getPtrValue(obj.ptr));
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
    const nameFactory = new SignalListItemFactory();
    nameFactory.onSetup((listItem) => {
      const label = new Label("");
      label.setHalign(Align.START);
      label.setMarginStart(10);
      label.setMarginEnd(10);
      listItem.child = label;
      uiElementsMap.set(getPtrValue(label.ptr), label);
    });
    nameFactory.onBind((listItem) => {
      const item = getRecipeItem(listItem.item);
      const child = listItem.child;
      if (!item || !child) return;
      const label = uiElementsMap.get(getPtrValue(child.ptr)) as Label;
      if (label) label.setText(item.recipe.name);
    });
    nameFactory.onTeardown((listItem) => {
      const child = listItem.child;
      if (child) uiElementsMap.delete(getPtrValue(child.ptr));
    });
    columnView.appendColumn(new ColumnViewColumn("Name", nameFactory));

    // Installed Column
    const installedFactory = new SignalListItemFactory();
    installedFactory.onSetup((listItem) => {
      const label = new Label("");
      label.setHalign(Align.START);
      label.setMarginStart(10);
      label.setMarginEnd(10);
      label.setProperty("width-chars", 12);
      label.setEllipsize(3); // END
      listItem.child = label;
      uiElementsMap.set(getPtrValue(label.ptr), label);
    });
    installedFactory.onBind((listItem) => {
      const item = getRecipeItem(listItem.item);
      const child = listItem.child;
      if (!item || !child) return;
      const label = uiElementsMap.get(getPtrValue(child.ptr)) as Label;
      item.versionLabel = label;
      updateItemStatus(chef, item);
    });
    installedFactory.onUnbind((listItem) => {
      const item = getRecipeItem(listItem.item);
      if (item) item.versionLabel = undefined;
    });
    installedFactory.onTeardown((listItem) => {
      const child = listItem.child;
      if (child) uiElementsMap.delete(getPtrValue(child.ptr));
    });
    columnView.appendColumn(
      new ColumnViewColumn("Installed", installedFactory),
    );

    // Latest Column
    const latestFactory = new SignalListItemFactory();
    latestFactory.onSetup((listItem) => {
      const label = new Label("");
      label.setHalign(Align.START);
      label.setMarginStart(10);
      label.setMarginEnd(10);
      label.setProperty("width-chars", 12);
      label.setEllipsize(3); // END
      listItem.child = label;
      uiElementsMap.set(getPtrValue(label.ptr), label);
    });
    latestFactory.onBind((listItem) => {
      const item = getRecipeItem(listItem.item);
      const child = listItem.child;
      if (!item || !child) return;
      const label = uiElementsMap.get(getPtrValue(child.ptr)) as Label;
      item.latestVersionLabel = label;
      updateItemStatus(chef, item);
    });
    latestFactory.onUnbind((listItem) => {
      const item = getRecipeItem(listItem.item);
      if (item) item.latestVersionLabel = undefined;
    });
    latestFactory.onTeardown((listItem) => {
      const child = listItem.child;
      if (child) uiElementsMap.delete(getPtrValue(child.ptr));
    });
    columnView.appendColumn(new ColumnViewColumn("Latest", latestFactory));

    // Status Column
    const statusFactory = new SignalListItemFactory();
    statusFactory.onSetup((listItem) => {
      const statusBox = new Box(Orientation.HORIZONTAL, 5);
      statusBox.setHalign(Align.START);
      statusBox.setMarginStart(10);
      statusBox.setMarginEnd(10);

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
      listItem.child = statusBox;
      uiElementsMap.set(getPtrValue(statusBox.ptr), {
        statusLabel,
        runningCounterLabel,
        updateAvailableLabel,
      });
    });
    statusFactory.onBind((listItem) => {
      const item = getRecipeItem(listItem.item);
      const child = listItem.child;
      if (!item || !child) return;
      const elements = uiElementsMap.get(getPtrValue(child.ptr));
      if (elements) {
        item.statusLabel = elements.statusLabel;
        item.runningCounterLabel = elements.runningCounterLabel;
        item.updateAvailableLabel = elements.updateAvailableLabel;
        updateItemStatus(chef, item);
      }
    });
    statusFactory.onUnbind((listItem) => {
      const item = getRecipeItem(listItem.item);
      if (item) {
        item.statusLabel = undefined;
        item.runningCounterLabel = undefined;
        item.updateAvailableLabel = undefined;
      }
    });
    statusFactory.onTeardown((listItem) => {
      const child = listItem.child;
      if (child) uiElementsMap.delete(getPtrValue(child.ptr));
    });
    columnView.appendColumn(new ColumnViewColumn("Status", statusFactory));

    // Actions Column
    const actionsFactory = new SignalListItemFactory();
    actionsFactory.onSetup((listItem) => {
      const actionBox = new Box(Orientation.HORIZONTAL, 5);
      actionBox.setHalign(Align.END);
      actionBox.setMarginStart(10);
      actionBox.setMarginEnd(10);

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

      actionBox.append(killBtn);
      actionBox.append(runBtn);
      actionBox.append(runInTerminalBtn);
      actionBox.append(installBtn);
      actionBox.append(cancelBtn);
      actionBox.append(moreBtn);

      listItem.child = actionBox;
      uiElementsMap.set(getPtrValue(actionBox.ptr), {
        installBtn,
        runBtn,
        runInTerminalBtn,
        killBtn,
        cancelBtn,
        moreBtn,
        updateBtn,
        removeBtn,
        changelogBtn,
        morePopover,
      });
    });
    actionsFactory.onBind((listItem) => {
      const item = getRecipeItem(listItem.item);
      const child = listItem.child;
      if (!item || !child) return;
      const elements = uiElementsMap.get(getPtrValue(child.ptr));
      if (elements) {
        item.installBtn = elements.installBtn;
        item.runBtn = elements.runBtn;
        item.runInTerminalBtn = elements.runInTerminalBtn;
        item.killBtn = elements.killBtn;
        item.cancelBtn = elements.cancelBtn;
        item.moreBtn = elements.moreBtn;
        item.updateBtn = elements.updateBtn;
        item.removeBtn = elements.removeBtn;
        item.changelogBtn = elements.changelogBtn;
        item.morePopover = elements.morePopover;

        item.installBtn!.onClick(async () => {
          await handleInstall(chef, item);
        });
        item.removeBtn!.onClick(async () => {
          await handleRemove(chef, item);
        });
        item.updateBtn!.onClick(async () => {
          await handleUpdate(chef, item);
        });
        item.cancelBtn!.onClick(() => {
          if (item.rowAbortController) {
            item.rowAbortController.abort();
          }
        });
        item.runBtn!.onClick(() => {
          chef.runBin(item.recipe.name, []);
        });
        item.runInTerminalBtn!.onClick(() => {
          chef.runInTerminal(item.recipe.name, []);
        });
        item.killBtn!.onClick(() => {
          chef.killAll(item.recipe.name);
        });
        item.changelogBtn!.onClick(() => {
          handleChangelog(chef, item);
        });

        updateItemStatus(chef, item);
      }
    });
    actionsFactory.onUnbind((listItem) => {
      const item = getRecipeItem(listItem.item);
      if (item) {
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
      }
    });
    actionsFactory.onTeardown((listItem) => {
      const child = listItem.child;
      if (child) uiElementsMap.delete(getPtrValue(child.ptr));
    });
    const actionsColumn = new ColumnViewColumn("Actions", actionsFactory);
    actionsColumn.expand = true;
    columnView.appendColumn(actionsColumn);

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
      item.installBtn.setLabel("Failed");
    }
  } finally {
    item.installBtn.setSensitive(true);
    item.installBtn.setLabel("Install");
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
    item.removeBtn.setSensitive(true);
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
    item.updateBtn.setLabel(isReinstall ? "Reinstall" : "Update");
  } finally {
    item.updateBtn.setSensitive(true);
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
