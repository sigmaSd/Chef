# Chef Integration Protocol (Providers)

Chef can act as a unified interface for other package managers or update tools
(e.g., `rustman`, `gh-extension`). This is achieved through the **Provider
Protocol**.

## 1. High-Level Concept

Instead of writing a Chef recipe for every single tool, you can register an
existing manager as a "Provider." Chef will then delegate listing and updating
tasks to that tool.

```
External Manager (e.g. rustman) <--> Protocol (JSON) <--> Chef GUI/CLI
```

## 2. Provider Discovery Protocol

A Provider is any CLI tool that implements a specific JSON-based interface.

### Registration

Register a provider with an alias and its base command:

```bash
chef provider add rustman "rustman --chef-api"
```

### Protocol Actions

#### `list`

Chef will call: `rustman --chef-api list` Expected JSON output:

```json
[
  {
    "name": "ripgrep",
    "version": "13.0.0",
    "latestVersion": "14.1.0",
    "description": "Recursively searches directories for a regex pattern",
    "updateCommand": "rustman install ripgrep"
  }
]
```

#### `update`

When the user clicks "Update" in the GUI, Chef executes the `updateCommand`
specified in the list output.

- Chef pipes the stdout/stderr of this command to its internal progress
  monitoring.
- A non-zero exit code indicates failure.

## 3. GUI Visual Cues

To ensure clarity, the Chef GUI will provide visual distinctions for integrated
apps:

- **Source Labels**: Each application row will display its source (e.g.,
  `via rustman`).
- **Unified Actions**: The "Update" and "Run" buttons work the same way
  regardless of whether the app is a native Chef recipe or an external provider.
- **Provider Management**: A settings section in the GUI to list, test, and
  remove registered providers.
