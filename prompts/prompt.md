I have a list of TODOs in `TODO.md`.

Continue with the remaining tasks in `TODO.md` one by one, starting with the
simplest. For each task

1. Plan the implementation.
2. Execute the changes.
3. Verify the changes (if possible).
4. Mark the task as completed in `TODO.md`.
5. Git commit the changes.

Note if you need a GTK API and its missing, you can do these steps:

1. set "vendor": true, in deno.json
2. run deno check
3. now gtk is under vendor, you can add missing apis there
4. continue working
5. after you're done with the task, before commiting the changes tell the user
   to upstream the gtk changes
