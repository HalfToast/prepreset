# Prepreset

A SillyTavern extension for keeping several prompt-toggle combinations under one
chat completion preset, instead of duplicating the whole preset every time.

Needs SillyTavern 1.18.0 or newer and a Chat Completion API, since the Prompt
Manager it extends only exists there.

## What it does

A chat completion preset carries dozens of prompts, each with an on/off toggle,
and different character cards want different combinations. Normally the only way
to keep those combinations is a full copy of the preset for each one, so every
edit to the shared parts has to be repeated across every copy.

Prepreset adds a sub-preset dropdown right above the Prompt Manager. A sub-preset
stores the enabled/disabled state of each prompt and nothing else. Pick one and
its toggles are applied; flip a toggle and it's saved back automatically.

* Sub-presets belong to the master preset they were created under.
* Switching is manual. Nothing is applied on character or chat switch.
* Prepreset never writes to your preset files. Sub-presets live in
  `settings.json` under `extension_settings.prepreset`.
* Save the master while a sub-preset is active and you get asked which toggles
  to save, the master's or the sub-preset's.

## Install

In SillyTavern, open the Extensions panel (the stacked-blocks icon), click
"Install extension", and paste:

```
https://github.com/HalfToast/prepreset
```

That's it. SillyTavern clones the repo into your user extensions directory and
loads it.

<details>
<summary>Manual install</summary>

```sh
git clone https://github.com/HalfToast/prepreset \
    SillyTavern/data/default-user/extensions/prepreset
```

The directory has to be named `prepreset`. Restart SillyTavern afterwards; the
extension list is built server-side at startup.

</details>

## Usage

Open AI Response Configuration and look at the row above the Prompt Manager.

| Button | Action |
| --- | --- |
| New | Creates a sub-preset from the toggles currently in effect |
| Rename | Renames the selected sub-preset |
| Duplicate | Copies the selected sub-preset |
| Delete | Removes the selected sub-preset and falls back to the master |

Selecting "- Master (no sub-preset) -" restores the toggles as saved in the
master preset file.

## Known limitations

**Renaming a master hides its sub-presets.** They're keyed by the master
preset's name, so after a rename the dropdown comes up empty: Prepreset is still
looking them up under the old name. Nothing is deleted, and renaming back brings
them all back, but there's no way around the disappearance itself.

The master preset file itself is fine either way, because Prepreset puts the
master's own toggles back before SillyTavern writes the renamed file. The one
exception is a master whose file has no prompt order at all. There's nothing to
restore from, so Prepreset warns instead of guessing and the rename behaves as
it would without the extension.

**Prompts added to the master after a sub-preset was saved** stay at the
master's state rather than switching off, since a sub-preset only knows about
the prompts that existed when it was last updated.

**"Save preset as" captures the active toggles, not the master's.** It snapshots
whatever is currently in effect, same as any other save from live settings.
Select "- Master (no sub-preset) -" first if you want the new preset to start
from the master's toggles.

**"Reset prompt order" permanently shrinks the active sub-preset.** The reset
replaces the live prompt order with the shorter built-in default and saves, and
auto-save snapshots that like any other change, so the sub-preset loses its
entries for the prompts the reset removed. Consistent with "every mutation
auto-saves", but it's the one action that destroys intent rather than recording
it.

## How it works

Sub-presets live in SillyTavern's `settings.json` under
`extension_settings.prepreset`, keyed by master preset name. Selecting one
writes its stored states into the live prompt order and re-renders the Prompt
Manager. Selecting Master reads the master's own states back out of the preset
file, so it stays truthful even after you edit and re-save the master.

Your preset files are only ever written by SillyTavern's own save actions.

## Development

No build step and no runtime dependencies; the files are served to the browser
as written.

```sh
npm test
```

The tests cover `src/store.js`, `src/toggles.js` and `src/escape.js`, which hold
all the logic and import nothing from SillyTavern. The DOM-facing parts
(`index.js`, `src/ui.js`, `src/guard.js`) have no automated coverage, so test
those by hand against a real SillyTavern after changing them.

For development, symlink the repo into the user extensions directory rather than
installing a copy:

```sh
ln -s /path/to/prepreset \
      /path/to/SillyTavern/data/default-user/extensions/prepreset
```

## License

MIT, see [LICENSE](LICENSE).
