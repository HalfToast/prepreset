# Prepreset

A SillyTavern extension for keeping several variations of one chat completion
preset (prompt toggles, samplers, context size and so on) without duplicating
the whole preset each time.

Needs SillyTavern 1.18.0 or newer and a Chat Completion API, since the presets
it extends only exist there.

## What it does

Different character cards want different prompt toggles and settings. Normally
that means a full copy of the preset for each one, and every edit to the shared
parts has to be repeated across all of them.

Prepreset adds a sub-preset dropdown under the master preset dropdown. A
sub-preset only stores what you changed from the master, like a few toggles or a
different temperature. Everything else follows the master, so edits to the
master still reach your sub-presets. Pick one, change what you want, and press
Save.

* Sub-presets belong to the master preset they were created under.
* Two operating modes: Manual (Sub-presets) and Auto-bound (Per-chat).
* In Manual mode, switching is manual and saving is explicit. Changing values
  never touches a stored sub-preset until you press Save.
* In Auto-bound mode, presets and toggles automatically follow each chat.
  The sub-preset dropdown is hidden, and overrides are saved directly into the
  active chat.
* Prepreset never writes to your preset files. Sub-presets live in
  `settings.json` under `extension_settings.prepreset`, while chat-bound overrides
  live inside each chat's metadata.
* Connection settings (source, model, URLs, proxy, credentials) are never part
  of a sub-preset or chat override. Prompt text and order always come from the
  master too; only on/off state is stored.
* Saving the master while a sub-preset or chat override is active asks whether
  to save the master's own values or what's on screen.

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

Open AI Response Configuration and look at the row under the master preset
dropdown.

| Button | Action |
| --- | --- |
| Save | Saves your changes into the selected sub-preset |
| New | Creates a sub-preset from your current changes |
| Rename | Renames the selected sub-preset |
| Duplicate | Copies the selected sub-preset |
| Delete | Removes the selected sub-preset and falls back to the master |

Selecting "- Master (no sub-preset) -" restores the values as saved in the
master preset file.

With unsaved changes, Save lights up and a `•` shows next to the name.
Switching away (to another sub-preset, to Master, or via New or Duplicate) asks
first.

## Operating modes

In the Prepreset drawer in the Extensions panel, choose your operating mode:

* **Manual (Sub-presets)** *(default)*: Sub-preset dropdown row under the master
  preset dropdown. Manage named variations with Save, New, Duplicate, and Delete.
* **Auto-bound (Per-chat)**: Fully automated. The sub-preset dropdown is removed.
  Each chat remembers its own master preset and any prompt toggle or parameter
  overrides you make while in that chat. Switching chats automatically selects the
  chat's master preset and applies its overrides. An in-chat toast notification
  and a top-bar badge display the active preset and override count.

## Settings

The Prepreset drawer in the Extensions panel picks which fields sub-presets
manage. By default it's only prompt toggles, so nothing else changes until you
turn parameters on. Fields are grouped (Sampling, Context & length, Reasoning &
tools, Prompt formatting, Media, Other) with All/None buttons for each group.

Unchecked fields are left alone when you switch sub-presets. If you uncheck a
field the active sub-preset changed, the master's value is put back so it can't
leak into the master preset file. Stored values aren't deleted; check the field
again and reselect the sub-preset to get them back (unless you press Save
first).

## Known limitations

* **Renaming a master hides its sub-presets.** They're keyed by preset name.
  Nothing is deleted, and renaming it back brings them back. The master file
  itself is safe, since Prepreset restores the master's values before the
  rename saves, unless toggles are managed and the master has no prompt order.
* **Prompts added to the master later** follow the master's state, since
  sub-presets only store toggles they changed.
* **Sub-presets from before parameter support store every toggle**, so master
  toggle changes don't reach them until you press Save on them once. A prompt
  added to the master since then may show `•` the first time; reselecting or
  saving clears it.
* **Values an old master file doesn't have can't be overridden.** There's
  nothing to compare against, so Prepreset leaves them alone like SillyTavern
  does.
* **A master with no prompt order can't use sub-presets while toggles are
  managed.** Selecting one warns and does nothing. Uncheck Prompt toggles to use
  parameter overrides with it.
* **Changing models can make a sub-preset look unsaved.** SillyTavern clamps
  some values (temperature, for example) to the model's range, which then
  differs from what's stored.
* **Continue postfix radios don't update when a sub-preset applies it.** The
  setting does change; the radios catch up on reload. SillyTavern's own preset
  switching has the same issue.
* **"Save preset as" saves what's on screen**, sub-preset changes included.
  Select Master first if you want the master's values.
* **Switching master presets drops unsaved changes without asking.** SillyTavern
  has already loaded the new preset by the time Prepreset finds out, so save
  first.

## How it works

Sub-presets live in `settings.json` under `extension_settings.prepreset`, keyed
by master preset name. Selecting one reads the master's values from its preset
file, applies the sub-preset's differences on top, and pushes the result through
the same controls SillyTavern uses when loading a preset. Selecting Master does
the same without the differences.

The field list comes from SillyTavern itself (minus connection settings), so new
parameters in future versions show up under Other automatically.

"Unsaved" isn't a stored flag. It's worked out by comparing live values to the
master plus the sub-preset's differences, which is why it survives a reload.

Your preset files are only ever written by SillyTavern's own save actions.

## Development

No build step and no runtime dependencies; the files are served to the browser
as written.

```sh
npm test
```

The tests cover the logic in `src/store.js`, `src/toggles.js`,
`src/overlay.js`, `src/fields.js` and `src/escape.js`. The DOM parts
(`index.js`, `src/ui.js`, `src/guard.js`, `src/settings-panel.js`) aren't
tested, so check those by hand in SillyTavern after changing them.

For development, symlink the repo into the user extensions directory rather than
installing a copy:

```sh
ln -s /path/to/prepreset \
      /path/to/SillyTavern/data/default-user/extensions/prepreset
```

## License

MIT, see [LICENSE](LICENSE).
