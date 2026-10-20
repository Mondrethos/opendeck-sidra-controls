# Sidra Controls for OpenDeck

An [OpenDeck](https://github.com/nekename/OpenDeck) plugin with Stream Deck keys
that control [Sidra](https://github.com/wimpysworld/sidra), the Apple Music
client for Linux. Each key shows its control while Sidra is running and stays
blank while it is not.

| Action | Does |
| --- | --- |
| Previous | previous track |
| Play/Pause | plays or pauses |
| Next | next track |
| Stop | stops playback |
| Close Sidra | quits Sidra |
| Volume Down / Volume Up | changes Sidra's volume by 5%, the same step as Sidra's scroll wheel |

The keys always control Sidra itself (`org.mpris.MediaPlayer2.sidra`), never
whichever other media player happens to be playing.

## Requirements

- Linux with a systemd user session (`busctl`)
- OpenDeck 2.x
- Node.js 20 or newer
- Sidra

## Install

Put this folder in OpenDeck's plugin directory under the plugin's ID, then
restart OpenDeck:

```bash
git clone https://github.com/Mondrethos/opendeck-sidra-controls.git \
  ~/.config/opendeck/plugins/local.sidracontrols.sdPlugin
```

The actions appear in OpenDeck's action list under **Sidra**.

## How it works

- Commands go to Sidra over MPRIS with `busctl --user`.
- Sidra counts as running while a live process named `sidra` exists. Zombie
  processes are ignored: OpenDeck's Launch App plugin never reaps the programs
  it starts, so a Sidra opened from a Launch App key lingers as a zombie after
  it quits.
- The plugin checks when OpenDeck reports a `sidra` process starting or exiting,
  and every two seconds, because OpenDeck misses an exit that leaves a zombie.

## A Sidra page

OpenDeck accepts profile switches only from its own Starter Pack, so this
plugin cannot change pages itself. A page for Sidra can be built from OpenDeck's
Multi Actions instead:

- On the main profile, a Multi Action of **Launch App** (Sidra) and **Switch
  Profile** (`Sidra`) opens Sidra, or brings it forward, and shows the page.
- On a profile named `Sidra`, put the controls, a **Switch Profile**
  (`Default`) key as Back, and a Multi Action of **Close Sidra** and **Switch
  Profile** (`Default`) to quit Sidra and return in one press.

## Credits

`icons/plugin.png` is Sidra's application icon from
[wimpysworld/sidra](https://github.com/wimpysworld/sidra), licensed under the
[Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0). The
other icons were drawn for this plugin in Sidra's colours.
