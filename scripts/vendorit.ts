const remove = Deno.args.includes("--remove");

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));
if (remove) {
  if (denoJson.vendor) delete denoJson.vendor;
} else {
  if (denoJson.vendor === true) {
    // pass
  } else {
    denoJson.vendor = true;
  }
}
Deno.writeTextFileSync("deno.json", JSON.stringify(denoJson, null, 2));

if (!remove) {
  await new Deno.Command("deno", {
    args: ["check"],
  }).spawn().status;
}
