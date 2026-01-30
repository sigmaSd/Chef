import {
  Align,
  Application,
  ApplicationWindow,
  Box,
  Button,
  Label,
  ListBox,
  ListBoxRow,
  Orientation,
  ProgressBar,
  ScrolledWindow,
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

    const titleLabel = new Label("Chef - Personal Package Manager");
    titleLabel.addCssClass("title-1");
    mainBox.append(titleLabel);

    const scrolledWindow = new ScrolledWindow();
    scrolledWindow.setVexpand(true);
    scrolledWindow.setHexpand(true);

    // Set a border around the list
    scrolledWindow.addCssClass("frame");

    const listBox = new ListBox();
    listBox.setSelectionMode(0); // NONE

    // Populate list
    for (const recipe of chef.recipes) {
      const row = createRecipeRow(chef, recipe);
      listBox.append(row);
    }

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
function createRecipeRow(chef: ChefInternal, recipe: Recipe): ListBoxRow {
  const row = new ListBoxRow();
  const box = new Box(Orientation.HORIZONTAL, 10);
  box.setMarginTop(10);
  box.setMarginBottom(10);
  box.setMarginStart(10);
  box.setMarginEnd(10);

  const nameLabel = new Label(recipe.name);
  nameLabel.setHalign(Align.START);
  nameLabel.setHexpand(true);
  box.append(nameLabel);

  const statusLabel = new Label("");
  const updateStatus = () => {
    const installed = chef.isInstalled(recipe.name);
    statusLabel.setText(installed ? "Installed" : "Not Installed");
    if (installed) {
      statusLabel.addCssClass("success");
      statusLabel.removeCssClass("dim-label");
    } else {
      statusLabel.addCssClass("dim-label");
      statusLabel.removeCssClass("success");
    }
  };
  updateStatus();
  box.append(statusLabel);

  const actionBox = new Box(Orientation.HORIZONTAL, 5);

  const installBtn = new Button("Install");
  const uninstallBtn = new Button("Uninstall");
  const updateBtn = new Button("Update");
  const runBtn = new Button("Run");

  const updateButtons = () => {
    const installed = chef.isInstalled(recipe.name);
    installBtn.setVisible(!installed);
    uninstallBtn.setVisible(installed);
    updateBtn.setVisible(installed);
    runBtn.setVisible(installed);
  };
  updateButtons();

  installBtn.onClick(async () => {
    installBtn.setSensitive(false);
    installBtn.setLabel("Installing...");
    try {
      await chef.installOrUpdate(recipe.name);
      updateStatus();
      updateButtons();
    } catch (e) {
      console.error(e);
      installBtn.setLabel("Failed");
    } finally {
      installBtn.setSensitive(true);
      installBtn.setLabel("Install");
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
    try {
      await chef.installOrUpdate(recipe.name, { force: true });
      updateStatus(); // Version might change?
    } catch (e) {
      console.error(e);
    } finally {
      updateBtn.setSensitive(true);
      updateBtn.setLabel("Update");
    }
  });

  runBtn.onClick(() => {
    // Run asynchronously to avoid blocking UI
    chef.runBin(recipe.name, []);
  });

  actionBox.append(installBtn);
  actionBox.append(updateBtn);
  actionBox.append(uninstallBtn);
  actionBox.append(runBtn);

  box.append(actionBox);
  row.setChild(box);

  return row;
}
