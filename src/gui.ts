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
  ScrolledWindow,
} from "@sigmasd/gtk/gtk4";
import { EventLoop } from "@sigmasd/gtk/eventloop";
import type { ChefInternal } from "./chef-internal.ts";
import type { Recipe } from "../mod.ts";

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

    window.setChild(mainBox);
    window.present();
  });

  await eventLoop.start(app);
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
