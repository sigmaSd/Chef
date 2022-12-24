import { Chef } from "./src/lib.ts";
import { Permissions } from "https://raw.githubusercontent.com/sigmaSd/deno-with-permissions-ts/master/api.ts";

const getEnvPermission = () => {
  switch (Deno.build.os) {
    case "linux": {
      return ["XDG_CACHE_HOME", "HOME"];
    }
    case "darwin": {
      return ["HOME"];
    }
    case "windows":
      return ["LOCALAPPDATA"];
  }
};

const permissions: Permissions = {
  read: [Chef.dbPath, Chef.binPath],
  write: [Chef.dbPath, Chef.binPath],
  env: getEnvPermission(),
  net: ["github.com"],
};

export default permissions;
