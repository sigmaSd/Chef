If a gtk api is missing or you just want to explore the gtk api run
`./scripts/vendorit.ts`, this will vendor gtk under vendor.

You can now add missing apis you need there.

File Structure Reference

```text
vendor/jsr.io/@sigmasd/gtk/
└── <version>/
    └── src/
        ├── low/           # Raw FFI definitions (gtk4.ts, adw.ts, etc.)
        └── high/          # Ergomatic TS Classes (Widget, Window, etc.)
```

Don't edit deno.json ! the script will automaticly set vendor: true, which will
make deno aware of vendor path

So the steps are:

1. run the vendor script
2. explore gtk and edit if you need
