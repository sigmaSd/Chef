import {
  Args,
  argument,
  cli,
  command,
  description,
  rawRest,
  required,
  subCommand,
  type,
} from "@sigma/parse";

// Command classes for CLI argument parsing
@command
export class RunCommand {
  @argument({ description: "name of the binary to run" })
  @type("string")
  @required()
  name!: string;

  @rawRest()
  binArgs: string[] = [];
}

@command
export class ListCommand {}

@command
export class UninstallCommand {
  @argument({ description: "name of the binary to uninstall", rest: true })
  @type("string[]")
  @required()
  binary: string[] = [];
}

@command
export class UpdateCommand {
  @description("force update a binary")
  force: boolean = false;

  @type("string")
  @description("skip updating a binary")
  skip?: string;

  @type("string")
  @description("only update this binary")
  only?: string;

  @description("only look for new versions but don't update")
  "dry-run": boolean = false;

  @argument({ description: "name of the binary to update", rest: true })
  @type("string[]")
  binary: string[] = [];
}

@command
export class EditCommand {}

@command
export class GuiCommand {}

@command
export class CreateDesktopCommand {
  @argument({ description: "name of the binary" })
  @type("string")
  @required()
  name!: string;

  @description("set Terminal=true in desktop file")
  terminal: boolean = false;

  @type("string")
  @description("set icon path in desktop file")
  icon?: string;
}

@command
export class RemoveDesktopCommand {
  @argument({ description: "name of the binary" })
  @type("string")
  @required()
  name!: string;
}

@command
export class LinkCommand {
  @argument({ description: "name of the binary to link" })
  @type("string")
  @required()
  name!: string;
}

@command
export class UnlinkCommand {
  @argument({ description: "name of the binary to unlink" })
  @type("string")
  @required()
  name!: string;
}

@command({ defaultCommand: "help" })
export class DesktopFileCommand {
  @subCommand(CreateDesktopCommand)
  @description("create a desktop file")
  create?: CreateDesktopCommand;

  @subCommand(RemoveDesktopCommand)
  @description("remove a desktop file")
  remove?: RemoveDesktopCommand;
}

/**
 * Type definitions for command handlers
 */
export interface CommandHandlers {
  run?: (name: string, binArgs: string[]) => Promise<void>;
  list?: () => void;
  update?: (options: {
    force?: boolean;
    skip?: string;
    only?: string;
    dryRun?: boolean;
    binary?: string[];
  }) => Promise<void>;
  uninstall?: (binary: string[]) => Promise<void>;
  edit?: () => string | undefined;
  gui?: () => Promise<void>;
  createDesktop?: (name: string, options: {
    terminal?: boolean;
    icon?: string;
  }) => Promise<void>;
  removeDesktop?: (name: string) => void;
  link?: (name: string) => Promise<void>;
  unlink?: (name: string) => Promise<void>;
}

// Using new @cli decorator and Args class pattern
@cli({
  name: "chef",
  description: "Manage random binaries",
  color: true,
  showDefaults: true,
  defaultCommand: "help",
  exitOnError: false, // Throw errors instead of exiting
})
class ChefArgs extends Args {
  @subCommand(RunCommand)
  @description("run a binary")
  run?: RunCommand;

  @subCommand(ListCommand)
  @description("list installed binaries")
  list?: ListCommand;

  @subCommand(UpdateCommand)
  @description("install/update binaries")
  install?: UpdateCommand;

  @subCommand(UpdateCommand)
  @description("update installed binaries")
  update?: UpdateCommand;

  @subCommand(UninstallCommand)
  @description("uninstall binaries")
  uninstall?: UninstallCommand;

  @subCommand(EditCommand)
  @description("output chef entry file")
  edit?: EditCommand;

  @subCommand(GuiCommand)
  @description("start the gui")
  gui?: GuiCommand;

  @subCommand(DesktopFileCommand)
  @description("manage desktop files")
  "desktop-file"?: DesktopFileCommand;

  @subCommand(LinkCommand)
  @description("create symlink to binary in exports directory")
  link?: LinkCommand;

  @subCommand(UnlinkCommand)
  @description("remove symlink from exports directory")
  unlink?: UnlinkCommand;
}

/**
 * Parse and execute commands using the new v0.17.0-rc1 API
 * Uses @cli decorator and Args class pattern
 */
export async function parseAndExecute(
  args: string[],
  handlers: CommandHandlers,
) {
  // Parse arguments using the new API
  const parsedArgs = ChefArgs.parse(args);

  // Execute commands based on what was parsed
  if (parsedArgs.run && handlers.run) {
    await handlers.run(parsedArgs.run.name!, parsedArgs.run.binArgs);
  } else if (parsedArgs.list && handlers.list) {
    handlers.list();
  } else if ((parsedArgs.update || parsedArgs.install) && handlers.update) {
    const updateArgs = parsedArgs.update || parsedArgs.install;
    await handlers.update({
      force: updateArgs!.force,
      skip: updateArgs!.skip,
      only: updateArgs!.only,
      dryRun: updateArgs!["dry-run"],
      binary: updateArgs!.binary,
    });
  } else if (parsedArgs.uninstall && handlers.uninstall) {
    await handlers.uninstall(parsedArgs.uninstall.binary);
  } else if (parsedArgs.edit && handlers.edit) {
    const result = handlers.edit();
    if (result) {
      console.log(result);
    }
  } else if (parsedArgs.gui && handlers.gui) {
    await handlers.gui();
  } else if (parsedArgs["desktop-file"]) {
    if (parsedArgs["desktop-file"].create && handlers.createDesktop) {
      await handlers.createDesktop(parsedArgs["desktop-file"].create.name!, {
        terminal: parsedArgs["desktop-file"].create.terminal,
        icon: parsedArgs["desktop-file"].create.icon,
      });
    } else if (parsedArgs["desktop-file"].remove && handlers.removeDesktop) {
      handlers.removeDesktop(parsedArgs["desktop-file"].remove.name!);
    }
  } else if (parsedArgs.link && handlers.link) {
    await handlers.link(parsedArgs.link.name!);
  } else if (parsedArgs.unlink && handlers.unlink) {
    await handlers.unlink(parsedArgs.unlink.name!);
  }
}
