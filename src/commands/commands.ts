import {
  argument,
  command,
  description,
  parse,
  rawRest,
  required,
  subCommand,
  type,
} from "@sigma/parse";

// Command classes for CLI argument parsing
@command
export class RunCommand {
  @argument(0, "name of the binary to run")
  @required()
  @type("string")
  static name: string;

  @rawRest("arguments passed to the binary")
  static binArgs: string[] = [];
}

@command
export class ListCommand {}

@command
export class UpdateCommand {
  @description("force update a binary")
  static force: boolean = false;

  @type("string")
  @description("skip updating a binary")
  static skip: string;

  @type("string")
  @description("only update this binary")
  static only: string;

  @description("only look for new versions but don't update")
  static dryRun: boolean = false;
}

@command
export class EditCommand {}

@command
export class CreateDesktopCommand {
  @argument(0, "name of the binary")
  @required()
  @type("string")
  static name: string;

  @description("set Terminal=true in desktop file")
  static terminal: boolean = false;

  @type("string")
  @description("set icon path in desktop file")
  static icon: string;
}

@command
export class RemoveDesktopCommand {
  @argument(0, "name of the binary")
  @required()
  @type("string")
  static name: string;
}

@command
export class DesktopFileCommand {
  @subCommand(CreateDesktopCommand)
  @description("create a desktop file")
  static create: CreateDesktopCommand;

  @subCommand(RemoveDesktopCommand)
  @description("remove a desktop file")
  static remove: RemoveDesktopCommand;
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
  }) => Promise<void>;
  edit?: () => string | undefined;
  createDesktop?: (name: string, options: {
    terminal?: boolean;
    icon?: string;
  }) => Promise<void>;
  removeDesktop?: (name: string) => void;
}

/**
 * Parse and execute commands using the new v0.11.0 Control Pattern
 * This is much cleaner - custom handlers have complete control!
 */
export async function parseAndExecute(
  args: string[],
  handlers: CommandHandlers,
) {
  // Using Control Pattern - custom handlers have complete control
  // No exceptions thrown, no process exits unless we decide
  @parse(args, {
    name: "chef",
    description: "Manage random binaries",
    color: true,
    showDefaults: true,
    defaultCommand: "help",
    exitOnError: false, // Throw errors instead of exiting
  })
  class ChefArgs {
    @subCommand(RunCommand)
    @description("run a binary")
    static run: RunCommand;

    @subCommand(ListCommand)
    @description("list installed binaries")
    static list: ListCommand;

    @subCommand(UpdateCommand)
    @description("update installed binaries")
    static update: UpdateCommand;

    @subCommand(EditCommand)
    @description("output chef entry file")
    static edit: EditCommand;

    @subCommand(DesktopFileCommand)
    @description("manage desktop files")
    static "desktop-file": DesktopFileCommand;
  }

  // Execute commands based on what was parsed
  // This always runs because our custom handlers chose to continue
  if (ChefArgs.run && handlers.run) {
    await handlers.run(RunCommand.name, RunCommand.binArgs);
  } else if (ChefArgs.list && handlers.list) {
    handlers.list();
  } else if (ChefArgs.update && handlers.update) {
    await handlers.update({
      force: UpdateCommand.force,
      skip: UpdateCommand.skip,
      only: UpdateCommand.only,
      dryRun: UpdateCommand.dryRun,
    });
  } else if (ChefArgs.edit && handlers.edit) {
    const result = handlers.edit();
    if (result) {
      console.log(result);
    }
  } else if (ChefArgs["desktop-file"]) {
    if (DesktopFileCommand.create && handlers.createDesktop) {
      await handlers.createDesktop(CreateDesktopCommand.name, {
        terminal: CreateDesktopCommand.terminal,
        icon: CreateDesktopCommand.icon,
      });
    } else if (DesktopFileCommand.remove && handlers.removeDesktop) {
      handlers.removeDesktop(RemoveDesktopCommand.name);
    }
  }
}
